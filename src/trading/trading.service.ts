import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { BinanceService } from '../binance/binance.service';
import { StateService } from '../state/state.service';
import { DiscordService } from '../discord/discord.service';
import { PositionDto } from '../common/dto/position.dto';
import { BotStateDto } from '../common/dto/bot-state.dto';
import { NewOrderSpot } from '../common/types/binance.types';

@Injectable()
export class TradingService {
  private readonly logger = new Logger(TradingService.name);
  private priceMonitorInterval: NodeJS.Timeout | null = null;
  private isMonitoringActive = false;

  constructor(
    private binanceService: BinanceService,
    private stateService: StateService,
    @Inject(forwardRef(() => DiscordService))
    private discordService: DiscordService,
  ) {}

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
      // We have a position: check sell signals
      await this.checkSellSignals(price, pos, state);
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
      const position = new PositionDto(
        params.symbol,
        qty,
        avgPrice,
        avgPrice,
        new Date().toISOString(),
      );

      state.positions[params.symbol] = position;
      state.remainingBudget -= txAmount;
      this.stateService.saveState(state);

      this.logger.log(
        `Bought ${qty} ${params.symbol} at avg price ${avgPrice}`,
      );

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
    if (pos.highestPrice > pos.buyPrice) {
      const trailingStopPrice = pos.highestPrice * (1 - params.decreasePct);
      const pullbackPct = ((pos.highestPrice - price) / pos.highestPrice) * 100;

      this.logger.debug(
        `📊 Trailing: highest ${pos.highestPrice.toFixed(8)}, stop ${trailingStopPrice.toFixed(8)}, current ${price}, pullback ${pullbackPct.toFixed(2)}%`,
      );

      // Ensure we won't sell at a loss
      if (price <= trailingStopPrice && price >= pos.buyPrice) {
        this.logger.log(
          `📈 Trailing stop triggered! Selling ${pos.quantity} ${pos.symbol} at ${price} (bought at ${pos.buyPrice}, profit: ${profitPct.toFixed(2)}%)`,
        );
        await this.executeSell(pos, price, state, 'trailing stop');
      }
    } else {
      this.logger.debug(
        'Position not yet in profit; waiting for price above buy price to enable trailing',
      );
    }
  }

  private async executeSell(
    pos: PositionDto,
    currentPrice: number,
    state: BotStateDto,
    reason: string,
  ): Promise<void> {
    const order = await this.binanceService.marketSell(
      pos.symbol,
      pos.quantity,
    );

    if (order) {
      const profit = (currentPrice - pos.buyPrice) * pos.quantity;
      const profitPct = ((currentPrice - pos.buyPrice) / pos.buyPrice) * 100;

      delete state.positions[pos.symbol];
      state.lastReferencePrice = currentPrice;
      this.stateService.saveState(state);

      this.logger.log(
        `💰 Position closed (${reason}): Profit: ${profit.toFixed(4)} USDT (${profitPct.toFixed(2)}%)`,
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
