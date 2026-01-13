import { Injectable, Logger } from '@nestjs/common';
import {
  Context,
  NumberOption,
  Options,
  SlashCommand,
  SlashCommandContext,
  StringOption,
} from 'necord';
import { TradingService } from '../trading/trading.service';
import { StateService } from '../state/state.service';
import { ParametersDto } from '../common/dto/parameters.dto';
import { BotStateDto } from '../common/dto/bot-state.dto';
import { PositionDto } from '../common/dto/position.dto';

class SetCoinDto {
  @StringOption({
    name: 'symbol',
    description: 'Trading symbol (e.g., BTCUSDT)',
    required: true,
  })
  symbol: string;
}

class SetPercentDto {
  @NumberOption({
    name: 'percent',
    description: 'Percentage value (e.g., 2 for 2%)',
    required: true,
    min_value: 0.01,
    max_value: 99.99,
  })
  percent: number;
}

class SetAmountDto {
  @NumberOption({
    name: 'amount',
    description: 'Amount in quote currency',
    required: true,
    min_value: 0.01,
  })
  amount: number;
}

@Injectable()
export class DiscordCommands {
  private readonly logger = new Logger(DiscordCommands.name);

  constructor(
    private tradingService: TradingService,
    private stateService: StateService,
  ) {}

  @SlashCommand({
    name: 'setcoin',
    description: 'Set the trading symbol (e.g., BTCUSDT)',
  })
  async onSetCoin(
    @Context() [interaction]: SlashCommandContext,
    @Options() { symbol }: SetCoinDto,
  ) {
    const upperSymbol = symbol.toUpperCase();
    const state = this.stateService.getState();
    state.params.symbol = upperSymbol;
    state.lastReferencePrice = null;
    this.stateService.saveState(state);

    return interaction.reply(`Symbol set to ${upperSymbol}`);
  }

  @SlashCommand({
    name: 'set_decrease',
    description: 'Set decrease percentage for buy trigger and trailing stop',
  })
  async onSetDecrease(
    @Context() [interaction]: SlashCommandContext,
    @Options() { percent }: SetPercentDto,
  ) {
    const pct = percent / 100;
    const state = this.stateService.getState();
    state.params.decreasePct = pct;
    this.stateService.saveState(state);

    return interaction.reply(
      `Decrease/trailing percent set to ${percent.toFixed(2)}%`,
    );
  }

  @SlashCommand({
    name: 'set_increase',
    description: 'Set increase percentage for profit target',
  })
  async onSetIncrease(
    @Context() [interaction]: SlashCommandContext,
    @Options() { percent }: SetPercentDto,
  ) {
    const pct = percent / 100;
    const state = this.stateService.getState();
    state.params.increasePct = pct;
    this.stateService.saveState(state);

    return interaction.reply(
      `Profit target percent set to ${percent.toFixed(2)}%`,
    );
  }

  @SlashCommand({
    name: 'set_amount',
    description: 'Set the transaction amount per trade',
  })
  async onSetAmount(
    @Context() [interaction]: SlashCommandContext,
    @Options() { amount }: SetAmountDto,
  ) {
    const state = this.stateService.getState();
    state.params.txAmount = amount;
    this.stateService.saveState(state);

    return interaction.reply(`Transaction amount set to ${amount}`);
  }

  @SlashCommand({
    name: 'set_budget',
    description: 'Set the total allocated budget',
  })
  async onSetBudget(
    @Context() [interaction]: SlashCommandContext,
    @Options() { amount }: SetAmountDto,
  ) {
    const state = this.stateService.getState();
    state.params.allocatedBudget = amount;
    state.remainingBudget = amount;
    this.stateService.saveState(state);

    return interaction.reply(`Allocated budget set to ${amount}`);
  }

  @SlashCommand({
    name: 'set_commission',
    description: 'Set the exchange commission percentage',
  })
  async onSetCommission(
    @Context() [interaction]: SlashCommandContext,
    @Options() { percent }: SetPercentDto,
  ) {
    const pct = percent / 100;
    const state = this.stateService.getState();
    state.params.commissionPct = pct;
    this.stateService.saveState(state);

    return interaction.reply(
      `Commission percentage set to ${percent.toFixed(2)}%`,
    );
  }

  @SlashCommand({
    name: 'set_max_price',
    description: 'Set the maximum price at which to allow buy orders',
  })
  async onSetMaxPrice(
    @Context() [interaction]: SlashCommandContext,
    @Options() { amount }: SetAmountDto,
  ) {
    const state = this.stateService.getState();
    state.params.maxBuyPrice = amount;
    this.stateService.saveState(state);

    return interaction.reply(`Maximum buy price set to ${amount}`);
  }

  @SlashCommand({
    name: 'clear_max_price',
    description: 'Clear the maximum buy price limit',
  })
  async onClearMaxPrice(@Context() [interaction]: SlashCommandContext) {
    const state = this.stateService.getState();
    state.params.maxBuyPrice = undefined;
    this.stateService.saveState(state);

    return interaction.reply('Maximum buy price limit cleared');
  }

  @SlashCommand({
    name: 'start',
    description: 'Start the trading bot',
  })
  async onStart(@Context() [interaction]: SlashCommandContext) {
    if (this.tradingService.isRunning()) {
      return interaction.reply({
        content: 'Bot is already running',
        ephemeral: true,
      });
    }

    try {
      this.tradingService.start();
      return interaction.reply('Bot started successfully');
    } catch (error) {
      this.logger.error('Error starting bot', error);
      return interaction.reply({
        content: 'Failed to start bot. Check logs for details.',
        ephemeral: true,
      });
    }
  }

  @SlashCommand({
    name: 'stop',
    description: 'Stop the trading bot',
  })
  async onStop(@Context() [interaction]: SlashCommandContext) {
    if (!this.tradingService.isRunning()) {
      return interaction.reply({
        content: 'Bot is not running',
        ephemeral: true,
      });
    }

    try {
      this.tradingService.stop();
      return interaction.reply('Bot stopped successfully');
    } catch (error) {
      this.logger.error('Error stopping bot', error);
      return interaction.reply({
        content: 'Failed to stop bot. Check logs for details.',
        ephemeral: true,
      });
    }
  }

  @SlashCommand({
    name: 'status',
    description: 'Show current bot status and configuration',
  })
  async onStatus(@Context() [interaction]: SlashCommandContext) {
    const state = this.stateService.getState();
    const p = state.params;

    // Initialize commission if it doesn't exist (for backward compatibility)
    const commission = p.commissionPct !== undefined ? p.commissionPct : 0.001;

    const statusMsg = [
      `**Symbol:** ${p.symbol}`,
      `**Decrease (trailing/buy trigger):** ${(p.decreasePct * 100).toFixed(2)}%`,
      `**Increase (profit target):** ${(p.increasePct * 100).toFixed(2)}%`,
      `**Commission:** ${(commission * 100).toFixed(2)}%`,
      `**Transaction amount:** ${p.txAmount}`,
      `**Max buy price:** ${p.maxBuyPrice !== undefined && p.maxBuyPrice !== null ? p.maxBuyPrice : 'None'}`,
      `**Allocated budget:** ${p.allocatedBudget}`,
      `**Remaining budget:** ${state.remainingBudget}`,
      `**Session profit (since last /start):** ${Number(
        state.sessionProfit || 0,
      ).toFixed(4)} USDT`,
      `**Positions:** ${Object.keys(state.positions).join(', ') || 'None'}`,
      `**Running:** ${state.running ? 'Yes' : 'No'}`,
    ].join('\n');

    return interaction.reply(statusMsg);
  }

  @SlashCommand({
    name: 'reset',
    description: 'Reset bot state to defaults (WARNING: clears all positions)',
  })
  async onReset(@Context() [interaction]: SlashCommandContext) {
    const state = new BotStateDto();
    state.params = new ParametersDto();
    state.remainingBudget = state.params.allocatedBudget;
    state.positions = {};
    state.lastReferencePrice = null;
    state.sessionProfit = 0;
    state.running = false;
    this.stateService.setState(state);

    return interaction.reply('State reset to defaults');
  }

  @SlashCommand({
    name: 'history',
    description: 'Show recent trade history',
  })
  async onHistory(@Context() [interaction]: SlashCommandContext) {
    try {
      await interaction.deferReply();

      const state = this.stateService.getState();

      // This would require adding a method to binance.service.ts to get trade history
      // For now, show position info
      const positionsArrays = Object.values(state.positions);
      const positions = positionsArrays.reduce(
        (all, arr) => all.concat(arr),
        [] as PositionDto[],
      );

      if (positions.length === 0) {
        return interaction.editReply('No open positions');
      }

      const positionInfo = positions
        .map(
          (p: PositionDto) =>
            `**${p.symbol}**\n` +
            `  Quantity: ${p.quantity}\n` +
            `  Avg Buy Price: ${p.buyPrice.toFixed(8)}\n` +
            `  Last Buy Price: ${
              p.lastBuyPrice ? p.lastBuyPrice.toFixed(8) : 'N/A'
            }\n` +
            `  Total Invested: ${
              p.totalInvested ? p.totalInvested.toFixed(2) : 'N/A'
            } USDT\n` +
            `  Highest: ${p.highestPrice.toFixed(8)}\n` +
            `  Entry Time: ${new Date(p.entryTime).toLocaleString()}`,
        )
        .join('\n\n');

      return interaction.editReply(
        `**Open Positions:**\n\n${positionInfo}\n\n_For full trade history, check Binance Testnet web interface_`,
      );
    } catch (error) {
      this.logger.error('Error fetching history', error);
      return interaction.editReply('Failed to fetch history');
    }
  }
}
