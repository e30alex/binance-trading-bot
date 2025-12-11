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

        const positionCount = Object.keys(state.positions).length;
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
    } catch (error) {
      this.logger.error('Error in price monitor loop', error);
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

    // Check if we have an open position for this symbol
    const pos = state.positions[params.symbol];

    if (!pos) {
      // No position: check buy signal
      await this.checkBuySignal(price, state);
    } else {
      // We have a position: check both sell signals AND buy signals (for averaging down)
      await this.checkSellSignals(price, pos, state);
      await this.checkBuySignal(price, state);
    }
  }

  private async checkBuySignal(
    price: number,
    state: BotStateDto,
  ): Promise<void> {
    const params = state.params;

    // Check if we have sufficient budget
    if (state.remainingBudget < params.txAmount) {
      this.logger.log(
        `Insufficient budget to buy: remaining ${state.remainingBudget}, required ${params.txAmount}`,
      );
      return;
    }

    // If there are no positions at all, buy immediately to start trading
    const hasAnyPositions = Object.keys(state.positions).length > 0;
    if (!hasAnyPositions) {
      this.logger.log(
        `🎯 Initial buy: No positions in portfolio. Buying at current market price ${price}`,
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

    // REMOVED: No longer preventing buys when position exists
    // Now we allow multiple buys based on price drops

    // Regular buy trigger: price <= last_reference_price * (1 - decrease_pct)
    const buyTriggerPrice =
      (state.lastReferencePrice ?? price) * (1 - params.decreasePct);

    if (price <= buyTriggerPrice) {
      this.logger.log(
        `📉 Buy signal: price ${price} dropped by ${(params.decreasePct * 100).toFixed(2)}% from reference ${state.lastReferencePrice ?? price}`,
      );

      const order = await this.binanceService.marketBuy(
        params.symbol,
        params.txAmount,
      );

      if (order) {
        await this.processBuyOrder(order, params.txAmount, state);
      }
    } else {
      // Update reference price if price moved higher
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

    // Calculate average price and quantity from order
    let qty = 0;
    let avgPrice = 0;

    if (order.fills && order.fills.length > 0) {
      qty = order.fills.reduce((sum, fill) => sum + parseFloat(fill.qty), 0);
      const totalValue = order.fills.reduce(
        (sum, fill) => sum + parseFloat(fill.price) * parseFloat(fill.qty),
        0,
      );
      avgPrice = totalValue / qty;
    } else {
      qty = parseFloat(order.executedQty || '0');
      const cumulativeQuoteQty = parseFloat(order.cummulativeQuoteQty || '0');
      avgPrice = qty > 0 ? cumulativeQuoteQty / qty : 0;
    }

    if (qty > 0) {
      // Check if we already have a position for this symbol
      const existingPosition = state.positions[params.symbol];

      if (existingPosition) {
        // Aggregate positions: combine quantities and calculate weighted average buy price
        const oldQty = existingPosition.quantity;
        const oldBuyPrice = existingPosition.buyPrice;
        const totalQty = existingPosition.quantity + qty;
        const totalCost =
          existingPosition.quantity * existingPosition.buyPrice +
          qty * avgPrice;
        const weightedAvgPrice = totalCost / totalQty;

        // Initialize totalInvested if it doesn't exist (for backward compatibility)
        if (existingPosition.totalInvested === undefined) {
          existingPosition.totalInvested =
            existingPosition.quantity * existingPosition.buyPrice;
        }

        // Update existing position with aggregated values
        existingPosition.quantity = totalQty;
        existingPosition.buyPrice = weightedAvgPrice;
        existingPosition.lastBuyPrice = avgPrice; // Track the most recent buy price
        existingPosition.totalInvested += txAmount; // Add to total invested
        // Keep the highest price from both positions
        existingPosition.highestPrice = Math.max(
          existingPosition.highestPrice,
          avgPrice,
        );

        this.logger.log(
          `Bought ${qty} ${params.symbol} at ${avgPrice}. Aggregated position: ${totalQty} @ ${weightedAvgPrice.toFixed(8)} (was ${oldQty} @ ${oldBuyPrice.toFixed(8)}). Total invested: ${existingPosition.totalInvested.toFixed(2)} USDT`,
        );
      } else {
        // Create new position
        const position = new PositionDto(
          params.symbol,
          qty,
          avgPrice,
          avgPrice,
          new Date().toISOString(),
          avgPrice,
          txAmount,
        );

        state.positions[params.symbol] = position;

        this.logger.log(
          `Bought ${qty} ${params.symbol} at avg price ${avgPrice}. Total invested: ${txAmount.toFixed(2)} USDT`,
        );
      }

      state.remainingBudget -= txAmount;
      // Update reference price to the buy price so we track drops from here
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
    pos: PositionDto,
    state: BotStateDto,
  ): Promise<void> {
    const params = state.params;

    // Update highest price
    pos.highestPrice = Math.max(pos.highestPrice, price);
    this.stateService.saveState(state);

    // Check profit target
    const targetPrice = pos.buyPrice * (1 + params.increasePct);
    const profitPct = ((price - pos.buyPrice) / pos.buyPrice) * 100;

    if (price >= targetPrice) {
      this.logger.log(
        `🎯 Profit target reached! Selling ${pos.quantity} ${pos.symbol} at ${price} (bought at ${pos.buyPrice}, profit: ${profitPct.toFixed(2)}%)`,
      );
      await this.executeSell(pos, price, state, 'profit target');
      return;
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

    this.logger.debug(
      'Position not yet in profit; waiting for price above buy price to enable trailing',
    );
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
      // Calculate actual sell revenue
      const sellRevenue = currentPrice * pos.quantity;

      // Get commission percentage (default to 0.1% if not set for backward compatibility)
      const commissionPct = params.commissionPct ?? 0.001;

      // Calculate commission on the sell (buy commission already deducted from quantity)
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

      // Replenish budget: ONLY add back the invested amount (profit is kept separate, not reinvested)
      state.remainingBudget += totalInvested;

      delete state.positions[pos.symbol];
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
        avgPrice: currentPrice,
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
