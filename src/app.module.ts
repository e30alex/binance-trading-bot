import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DiscordModule } from './discord/discord.module';
import { TradingModule } from './trading/trading.module';
import { BinanceModule } from './binance/binance.module';
import { StateModule } from './state/state.module';
import configuration from './config/configuration';
import { NecordModule } from 'necord';
import { GatewayIntentBits } from 'discord.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    NecordModule.forRootAsync({
      useFactory: (configService: ConfigService) => {
        const token = configService.get<string>('discord.botToken');
        if (!token) {
          throw new Error('DISCORD_BOT_TOKEN environment variable is required');
        }
        return {
          token,
          intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
          ],
        };
      },
      inject: [ConfigService],
    }),
    DiscordModule,
    TradingModule,
    BinanceModule,
    StateModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
