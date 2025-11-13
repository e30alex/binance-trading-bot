import {
  Injectable,
  Logger,
  OnModuleInit,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, TextChannel, EmbedBuilder } from 'discord.js';
import { StateService } from '../state/state.service';

@Injectable()
export class DiscordService implements OnModuleInit {
  private readonly logger = new Logger(DiscordService.name);
  private notificationChannelId: string | null = null;
  private onReadyCallbacks: Array<() => void> = [];
  private readyHandlerCompleted = false;

  constructor(
    @Inject(Client) private readonly client: Client,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => StateService))
    private readonly stateService: StateService,
  ) {}

  onModuleInit() {
    // Get the notification channel ID from config or environment
    this.notificationChannelId =
      this.configService.get<string>('discord.notificationChannelId') || null;

    this.logger.log(
      `Discord service initialized. Notification channel: ${this.notificationChannelId || 'Not set'}`,
    );

    // Set up listener for when Discord client is ready
    if (this.client.isReady()) {
      // Client is already ready, handle immediately
      void this.handleDiscordReady();
    } else {
      // Wait for ready event
      this.client.once('ready', () => {
        this.logger.log('Discord client is ready');
        void this.handleDiscordReady();
      });
    }
  }

  /**
   * Register a callback to be executed after Discord is ready and restart notification is sent
   */
  registerOnReadyCallback(callback: () => void): void {
    if (this.readyHandlerCompleted) {
      // Ready handler has already completed, execute immediately
      callback();
    } else {
      // Queue for later (will be executed after notification is sent)
      this.onReadyCallbacks.push(callback);
    }
  }

  private async handleDiscordReady(): Promise<void> {
    // Check if bot was running when app stopped
    const state = this.stateService.getState();

    if (state.running) {
      this.logger.log(
        '🔄 Bot was running before shutdown. Sending restart notification...',
      );

      const positionCount = Object.keys(state.positions).length;

      // Send restart notification
      await this.sendBotRestartNotification({
        symbol: state.params.symbol,
        hasPositions: positionCount > 0,
        positionCount: positionCount,
      });

      // Mark as completed and execute all registered callbacks (e.g., start price monitoring)
      this.readyHandlerCompleted = true;
      this.onReadyCallbacks.forEach((callback) => {
        try {
          callback();
        } catch (error) {
          this.logger.error('Error executing onReady callback', error);
        }
      });
      this.onReadyCallbacks = [];
    } else {
      // Bot was not running, but mark as completed so callbacks can execute immediately if registered later
      this.readyHandlerCompleted = true;
    }
  }

  async sendBuyNotification(orderDetails: {
    symbol: string;
    orderId: string | number;
    status: string;
    executedQty: string | number;
    cummulativeQuoteQty: string | number;
    avgPrice: number;
    fills: number;
  }) {
    if (!this.notificationChannelId) {
      this.logger.warn('No notification channel set. Skipping notification.');
      return;
    }

    try {
      const channel = await this.client.channels.fetch(
        this.notificationChannelId,
      );

      if (!channel || !(channel instanceof TextChannel)) {
        this.logger.error('Invalid notification channel');
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0x00ff00) // Green for buy
        .setTitle('✅ BUY ORDER EXECUTED')
        .addFields(
          { name: 'Symbol', value: orderDetails.symbol, inline: true },
          {
            name: 'Order ID',
            value: String(orderDetails.orderId),
            inline: true,
          },
          { name: 'Status', value: orderDetails.status, inline: true },
          {
            name: 'Executed Qty',
            value: String(orderDetails.executedQty),
            inline: true,
          },
          {
            name: 'Total Cost',
            value: `${orderDetails.cummulativeQuoteQty} USDT`,
            inline: true,
          },
          {
            name: 'Avg Price',
            value: orderDetails.avgPrice.toFixed(8),
            inline: true,
          },
          { name: 'Fills', value: String(orderDetails.fills), inline: true },
        )
        .setTimestamp();

      await channel.send({ embeds: [embed] });
    } catch (error) {
      this.logger.error('Error sending buy notification', error);
    }
  }

  async sendSellNotification(orderDetails: {
    symbol: string;
    orderId: string | number;
    status: string;
    executedQty: string | number;
    cummulativeQuoteQty: string | number;
    avgPrice: number;
    fills: number;
    profit?: number;
    profitPct?: number;
    reason?: string;
  }) {
    if (!this.notificationChannelId) {
      this.logger.warn('No notification channel set. Skipping notification.');
      return;
    }

    try {
      const channel = await this.client.channels.fetch(
        this.notificationChannelId,
      );

      if (!channel || !(channel instanceof TextChannel)) {
        this.logger.error('Invalid notification channel');
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0xff9900) // Orange for sell
        .setTitle('✅ SELL ORDER EXECUTED')
        .addFields(
          { name: 'Symbol', value: orderDetails.symbol, inline: true },
          {
            name: 'Order ID',
            value: String(orderDetails.orderId),
            inline: true,
          },
          { name: 'Status', value: orderDetails.status, inline: true },
          {
            name: 'Executed Qty',
            value: String(orderDetails.executedQty),
            inline: true,
          },
          {
            name: 'Total Revenue',
            value: `${orderDetails.cummulativeQuoteQty} USDT`,
            inline: true,
          },
          {
            name: 'Avg Price',
            value: orderDetails.avgPrice.toFixed(8),
            inline: true,
          },
          { name: 'Fills', value: String(orderDetails.fills), inline: true },
        )
        .setTimestamp();

      if (
        orderDetails.profit !== undefined &&
        orderDetails.profitPct !== undefined
      ) {
        embed.addFields({
          name: '💰 Profit',
          value: `${orderDetails.profit.toFixed(4)} USDT (${orderDetails.profitPct.toFixed(2)}%)`,
          inline: false,
        });
      }

      if (orderDetails.reason) {
        embed.addFields({
          name: 'Reason',
          value: orderDetails.reason,
          inline: false,
        });
      }

      await channel.send({ embeds: [embed] });
    } catch (error) {
      this.logger.error('Error sending sell notification', error);
    }
  }

  async sendMessage(channelId: string, message: string) {
    try {
      const channel = await this.client.channels.fetch(channelId);

      if (!channel || !(channel instanceof TextChannel)) {
        this.logger.error('Invalid channel');
        return;
      }

      await channel.send(message);
    } catch (error) {
      this.logger.error('Error sending message', error);
    }
  }

  async sendBotRestartNotification(state: {
    symbol: string;
    hasPositions: boolean;
    positionCount: number;
  }) {
    this.notificationChannelId =
      this.configService.get<string>('discord.notificationChannelId') || null;

    if (!this.notificationChannelId) {
      this.logger.warn(
        'No notification channel set. Skipping restart notification.',
      );
      return;
    }

    if (!this.client.isReady()) {
      this.logger.error(
        'Discord client is not ready. This should not happen in handleDiscordReady.',
      );
      return;
    }

    try {
      const channel = await this.client.channels.fetch(
        this.notificationChannelId,
      );

      if (!channel || !(channel instanceof TextChannel)) {
        this.logger.error('Invalid notification channel');
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0x3498db) // Blue for info/restart
        .setTitle('🔄 BOT RESTARTED')
        .setDescription(
          'The trading bot has been restarted and automatically resumed monitoring.',
        )
        .addFields(
          { name: 'Trading Symbol', value: state.symbol, inline: true },
          { name: 'Status', value: '🟢 Monitoring Active', inline: true },
          {
            name: 'Open Positions',
            value: state.hasPositions
              ? `${state.positionCount} position(s)`
              : 'None',
            inline: true,
          },
        )
        .setTimestamp();

      await channel.send({ embeds: [embed] });
      this.logger.log('Sent bot restart notification to Discord');
    } catch (error) {
      this.logger.error('Error sending restart notification', error);
    }
  }
}
