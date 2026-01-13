import {
  Injectable,
  Logger,
  Inject,
  forwardRef,
  OnModuleInit,
} from '@nestjs/common';
import { BinanceService } from '../binance/binance.service';
import { StateService } from '../state/state.service';
import { DiscordService } from '../discord/discord.service';
import { PositionDto } from '../common/dto/position.dto';
import { BotStateDto } from '../common/dto/bot-state.dto';
import { NewOrderSpot } from '../common/types/binance.types';

@Injectable()
export class TradingService implements OnModuleInit {
  private readonly logger = new Logger(TradingService.name);
  private priceMonitorInterval: NodeJS.Timeout | null = null;
  private isMonitoringActive = false;

  constructor(
    private binanceService: BinanceService,
    private stateService: StateService,
    @Inject(forwardRef(() => DiscordService))
    private discordService: DiscordService,
  ) {}

  onModuleInit() {
    // Check if bot was running when app stopped and auto-resume
    const state = this.stateService.getState();

    if (state.running) {
      this.logger.log(
        '🔄 Bot was running before shutdown. Will resume after Discord notification is sent...',
      );

      // Register callback to start price monitoring after Discord is ready and notification is sent
      this.discordService.registerOnReadyCallback(() => {
        this.logger.log(
          'Starting price monitoring after restart notification...',
        );
        this.startPriceMonitorLoop();

        const allPositions = Object.values(state.positions);
        const positionCount = allPositions.reduce(
          (sum, arr) => sum + arr.length,
          0,
        );
        this.logger.log(
          `✅ Price monitoring resumed for ${state.params.symbol}${positionCount > 0 ? ` with ${positionCount} open position(s)` : ''}`,
        );
      });
    } else {
      this.logger.log(
        'Bot was not running before shutdown. Waiting for /start command.',
      );
    }
  }

  start(): void {
    const state = this.stateService.getState();

    if (state.running) {
      this.logger.warn('Trading bot is already running');
      return;
    }

    // New session: reset session profit counter
    state.sessionProfit = 0;
    state.running = true;
    this.stateService.saveState(state);
    this.logger.log('Trading bot started');

    // Start price monitoring loop
    this.startPriceMonitorLoop();
  }

  stop(): void {
    const state = this.stateService.getState();

    if (!state.running) {
      this.logger.warn('Trading bot is not running');
      return;
    }

    state.running = false;
    this.stateService.saveState(state);

    if (this.priceMonitorInterval) {
      clearInterval(this.priceMonitorInterval);
      this.priceMonitorInterval = null;
    }

    this.logger.log('Trading bot stopped');
  }

  private startPriceMonitorLoop(): void {
    // Poll price every 2 seconds
    this.priceMonitorInterval = setInterval(() => {
      // Only start a new iteration if the previous one completed
      if (!this.isMonitoringActive) {
        void this.executeMonitoringIteration();
      }
    }, 2000);
  }

  private async executeMonitoringIteration(): Promise<void> {
    this.isMonitoringActive = true;
    try {
      const state = this.stateService.getState();

      if (!state.running) {
        if (this.priceMonitorInterval) {
          clearInterval(this.priceMonitorInterval);
          this.priceMonitorInterval = null;
        }
        return;
      }

      const price = await this.binanceService.getCurrentPrice(
        state.params.symbol,
      );
      await this.onPrice(price);
    } catch (error: unknown) {
      if (error instanceof Error) {
        this.logger.error(
          'Error in price monitor loop',
          error.stack ?? error.message,
        );
      } else {
        this.logger.error('Error in price monitor loop', JSON.stringify(error));
      }
    } finally {
      this.isMonitoringActive = false;
    }
  }

  private async onPrice(price: number): Promise<void> {
    const state = this.stateService.getState();
    const params = state.params;

    this.logger.debug(`Price update ${params.symbol}: ${price}`);

    // Initialize reference price if not set
    if (state.lastReferencePrice === null) {
      state.lastReferencePrice = price;
      this.stateService.saveState(state);
      return;
    }

    // Check if we have open positions for this symbol
    const positionsForSymbol = state.positions[params.symbol] ?? [];

    if (positionsForSymbol.length === 0) {
      // No position: check buy signal
      await this.checkBuySignal(price, state);
    } else {
      // We have one or more positions: check sell signals for each AND buy signals (for averaging down)
      await this.checkSellSignals(price, positionsForSymbol, state);
      await this.checkBuySignal(price, state);
    }
  }

  private async checkBuySignal(
    price: number,
    state: BotStateDto,
  ): Promise<void> {
    const params = state.params;
    const commissionPct = params.commissionPct ?? 0.001; // Default 0.1% if not set

    // Check if price exceeds maximum buy price limit
    if (
      params.maxBuyPrice !== undefined &&
      params.maxBuyPrice !== null &&
      price > params.maxBuyPrice
    ) {
      this.logger.debug(
        `Price ${price} exceeds max buy price ${params.maxBuyPrice}. Skipping buy signal.`,
      );
      return;
    }

    // Check if we have sufficient budget (include estimated buy-side commission)
    const estimatedTotalCost = params.txAmount * (1 + commissionPct);

    if (state.remainingBudget < estimatedTotalCost) {
      this.logger.log(
        `Insufficient budget to buy: remaining ${state.remainingBudget.toFixed(2)}, required (including commission) ${estimatedTotalCost.toFixed(2)}`,
      );
      return;
    }

    // Positions for the current symbol
    const positionsForSymbol =
      (state.positions[params.symbol] as PositionDto[] | undefined) ?? [];
    const hasOpenForSymbol = positionsForSymbol.length > 0;

    // If there are no open positions for this symbol, always place a new buy
    // (initial trade or after all previous positions have been closed)
    if (!hasOpenForSymbol) {
      this.logger.log(
        `🎯 No open positions for ${params.symbol}. Buying at current market price ${price}`,
      );

      const order = await this.binanceService.marketBuy(
        params.symbol,
        params.txAmount,
      );

      if (order) {
        await this.processBuyOrder(order, params.txAmount, state);
      }
      return;
    }

    // Regular buy trigger when we already have an open position:
    // use lastReferencePrice as the anchor for further buys (averaging down)
    const referencePrice = state.lastReferencePrice ?? price;

    const buyTriggerPrice = referencePrice * (1 - params.decreasePct);

    if (price <= buyTriggerPrice) {
      this.logger.log(
        `📉 Buy signal: price ${price} dropped by ${(params.decreasePct * 100).toFixed(2)}% from reference ${referencePrice}`,
      );

      const order = await this.binanceService.marketBuy(
        params.symbol,
        params.txAmount,
      );

      if (order) {
        await this.processBuyOrder(order, params.txAmount, state);
      }
    } else {
      // Update reference price if price moved higher while we have an open position
      if (
        state.lastReferencePrice === null ||
        price > state.lastReferencePrice
      ) {
        state.lastReferencePrice = price;
        this.stateService.saveState(state);
      }
    }
  }

  private async processBuyOrder(
    order: NewOrderSpot,
    txAmount: number,
    state: BotStateDto,
  ): Promise<void> {
    const params = state.params;
    const commissionPct = params.commissionPct ?? 0.001; // Default 0.1% if not set

    // Calculate average price and quantity from order
    let qty = 0;
    let avgPrice = 0;
    let quoteSpent = txAmount;

    if (order.fills && order.fills.length > 0) {
      qty = order.fills.reduce((sum, fill) => sum + parseFloat(fill.qty), 0);
      const totalValue = order.fills.reduce(
        (sum, fill) => sum + parseFloat(fill.price) * parseFloat(fill.qty),
        0,
      );
      avgPrice = totalValue / qty;
    } else {
      qty = parseFloat(order.executedQty || '0');
    }

    // Prefer actual quote amount from order if available
    const cumulativeQuoteQty = parseFloat(order.cummulativeQuoteQty || '0');
    if (!isNaN(cumulativeQuoteQty) && cumulativeQuoteQty > 0 && qty > 0) {
      quoteSpent = cumulativeQuoteQty;
      avgPrice = cumulativeQuoteQty / qty;
    }

    // Estimate buy-side commission and total invested for this order
    const buyCommission = quoteSpent * commissionPct;
    const investedAmount = quoteSpent + buyCommission;

    if (qty > 0) {
      // Create a new independent position (do not aggregate with previous buys)
      const position = new PositionDto(
        params.symbol,
        qty,
        avgPrice,
        avgPrice,
        new Date().toISOString(),
        avgPrice,
        investedAmount,
      );

      const positionsForSymbol =
        (state.positions[params.symbol] as PositionDto[] | undefined) ?? [];
      positionsForSymbol.push(position);
      state.positions[params.symbol] = positionsForSymbol;

      this.logger.log(
        `Bought ${qty} ${params.symbol} at avg price ${avgPrice}. New position #${positionsForSymbol.length} opened. Total invested (incl. buy fee): ${investedAmount.toFixed(2)} USDT`,
      );

      // Deduct quote spent + estimated buy-side commission from budget
      state.remainingBudget -= investedAmount;
      // Track last buy price and update reference price so we track drops from here
      state.lastPositionBuyPrice = avgPrice;
      state.lastReferencePrice = avgPrice;
      this.stateService.saveState(state);

      // Send Discord notification
      await this.discordService.sendBuyNotification({
        symbol: params.symbol,
        orderId: order.orderId,
        status: order.status,
        executedQty: order.executedQty || '0',
        cummulativeQuoteQty: order.cummulativeQuoteQty || '0',
        avgPrice: avgPrice,
        fills: order.fills?.length || 0,
      });
    } else {
      this.logger.warn('Buy executed but qty=0');
    }
  }

  private async checkSellSignals(
    price: number,
    positions: PositionDto[],
    state: BotStateDto,
  ): Promise<void> {
    const params = state.params;

    if (!positions || positions.length === 0) {
      this.logger.debug('No positions for symbol; skipping sell checks');
      return;
    }

    // Update highest price for all positions
    for (const p of positions) {
      p.highestPrice = Math.max(p.highestPrice, price);
    }
    this.stateService.saveState(state);

    let anySold = false;

    // Check profit target for each independent position
    for (const p of [...positions]) {
      const targetPrice = p.buyPrice * (1 + params.increasePct);
      const profitPct = ((price - p.buyPrice) / p.buyPrice) * 100;

      if (price >= targetPrice) {
        this.logger.log(
          `🎯 Profit target reached! Selling ${p.quantity} ${p.symbol} at ${price} (bought at ${p.buyPrice}, profit: ${profitPct.toFixed(2)}%)`,
        );
        await this.executeSell(p, price, state, 'profit target');
        anySold = true;
      }
    }

    // Trailing stop: only engage if price has risen above buy price
    // if (pos.highestPrice > pos.buyPrice) {
    //   const trailingStopPrice = pos.highestPrice * (1 - params.decreasePct);
    //   const pullbackPct = ((pos.highestPrice - price) / pos.highestPrice) * 100;

    //   this.logger.debug(
    //     `📊 Trailing: highest ${pos.highestPrice.toFixed(8)}, stop ${trailingStopPrice.toFixed(8)}, current ${price}, pullback ${pullbackPct.toFixed(2)}%`,
    //   );

    //   // Ensure we won't sell at a loss
    //   if (price <= trailingStopPrice && price >= pos.buyPrice) {
    //     this.logger.log(
    //       `📈 Trailing stop triggered! Selling ${pos.quantity} ${pos.symbol} at ${price} (bought at ${pos.buyPrice}, profit: ${profitPct.toFixed(2)}%)`,
    //     );
    //     await this.executeSell(pos, price, state, 'trailing stop');
    //   }
    // } else {
    //   this.logger.debug(
    //     'Position not yet in profit; waiting for price above buy price to enable trailing',
    //   );
    // }

    if (!anySold) {
      this.logger.debug(
        'Position(s) not yet in profit; waiting for price above buy price to enable trailing',
      );
    }
  }

  private async executeSell(
    pos: PositionDto,
    currentPrice: number,
    state: BotStateDto,
    reason: string,
  ): Promise<void> {
    const params = state.params;
    const order = await this.binanceService.marketSell(
      pos.symbol,
      pos.quantity,
    );

    if (order) {
      // Calculate actual sell revenue (prefer Binance-reported quote quantity)
      let sellRevenue = currentPrice * pos.quantity;
      const cumulativeQuoteQty = parseFloat(order.cummulativeQuoteQty ?? '0');
      if (!isNaN(cumulativeQuoteQty) && cumulativeQuoteQty > 0) {
        sellRevenue = cumulativeQuoteQty;
      }

      // Get commission percentage (default to 0.1% if not set for backward compatibility)
      const commissionPct = params.commissionPct ?? 0.001;

      // Calculate commission on the sell (buy-side commission already accounted for in totalInvested)
      const sellCommission = sellRevenue * commissionPct;

      // Net revenue after sell commission
      const netRevenue = sellRevenue - sellCommission;

      // Initialize totalInvested if it doesn't exist (for backward compatibility)
      const totalInvested =
        pos.totalInvested !== undefined
          ? pos.totalInvested
          : pos.quantity * pos.buyPrice;

      // Calculate profit (net revenue minus what we invested)
      const profit = netRevenue - totalInvested;
      const profitPct = (profit / totalInvested) * 100;

      // Accumulate session profit (net of all commissions)
      state.sessionProfit = Number(state.sessionProfit || 0) + profit;

      // Persist the latest buy price from the closed position for future re-entry logic
      state.lastPositionBuyPrice = pos.lastBuyPrice ?? pos.buyPrice;

      // Replenish budget: ONLY add back the invested amount (profit is kept separate, not reinvested)
      state.remainingBudget += totalInvested;

      // Remove only this specific position from the symbol's list
      const existingPositions =
        (state.positions[pos.symbol] as PositionDto[] | undefined) ?? [];
      const remainingPositions = existingPositions.filter((p) => p !== pos);

      if (remainingPositions.length > 0) {
        state.positions[pos.symbol] = remainingPositions;
      } else {
        delete state.positions[pos.symbol];
      }

      state.lastReferencePrice = currentPrice;
      this.stateService.saveState(state);

      this.logger.log(
        `💰 Position closed (${reason}): Invested: ${totalInvested.toFixed(2)} USDT, Revenue: ${netRevenue.toFixed(2)} USDT (after ${sellCommission.toFixed(4)} commission), Profit: ${profit.toFixed(4)} USDT (${profitPct.toFixed(2)}%). Budget replenished to: ${state.remainingBudget.toFixed(2)} USDT`,
      );

      // Send Discord notification
      await this.discordService.sendSellNotification({
        symbol: pos.symbol,
        orderId: order.orderId,
        status: order.status,
        executedQty: order.executedQty ?? '0',
        cummulativeQuoteQty: order.cummulativeQuoteQty ?? '0',
        avgPrice: sellRevenue > 0 ? sellRevenue / pos.quantity : currentPrice,
        fills: order.fills?.length || 0,
        profit: profit,
        profitPct: profitPct,
        reason: reason,
      });
    }
  }

  isRunning(): boolean {
    return this.stateService.getState().running;
  }
}
