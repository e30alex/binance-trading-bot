import { Module, forwardRef } from '@nestjs/common';
import { TradingService } from './trading.service';
import { BinanceModule } from '../binance/binance.module';
import { StateModule } from '../state/state.module';
import { DiscordModule } from '../discord/discord.module';

@Module({
  imports: [BinanceModule, StateModule, forwardRef(() => DiscordModule)],
  providers: [TradingService],
  exports: [TradingService],
})
export class TradingModule {}
