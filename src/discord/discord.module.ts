import { Module } from '@nestjs/common';
import { DiscordCommands } from './discord.commands';
import { DiscordService } from './discord.service';
import { TradingModule } from '../trading/trading.module';
import { StateModule } from '../state/state.module';

@Module({
  imports: [TradingModule, StateModule],
  providers: [DiscordCommands, DiscordService],
  exports: [DiscordService],
})
export class DiscordModule {}
