import { ParametersDto } from './parameters.dto';
import { PositionDto } from './position.dto';

export class BotStateDto {
  params: ParametersDto;
  remainingBudget: number;
  // Map from symbol -> list of independent positions (lots)
  positions: Record<string, PositionDto[]>;
  lastReferencePrice: number | null;
  // Stores the buy price of the most recently opened/closed position
  // Used to decide when to re-enter after a sell.
  lastPositionBuyPrice: number | null;
  // Cumulative profit (in quote currency, e.g. USDT) for the current session (/start → /stop)
  sessionProfit: number;
  running: boolean;

  constructor() {
    this.params = new ParametersDto();
    this.remainingBudget = this.params.allocatedBudget;
    this.positions = {};
    this.lastReferencePrice = null;
    this.lastPositionBuyPrice = null;
    this.sessionProfit = 0;
    this.running = false;
  }
}
