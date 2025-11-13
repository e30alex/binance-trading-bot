import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, TextChannel, EmbedBuilder } from 'discord.js';

@Injectable()
export class DiscordService implements OnModuleInit {
  private readonly logger = new Logger(DiscordService.name);
  private notificationChannelId: string | null = null;

  constructor(
    @Inject(Client) private readonly client: Client,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    // Get the notification channel ID from config or environment
    this.notificationChannelId =
      this.configService.get<string>('discord.notificationChannelId') || null;

    this.logger.log(
      `Discord service initialized. Notification channel: ${this.notificationChannelId || 'Not set'}`,
    );
  }

  setNotificationChannel(channelId: string) {
    this.notificationChannelId = channelId;
    this.logger.log(`Notification channel set to: ${channelId}`);
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
}
