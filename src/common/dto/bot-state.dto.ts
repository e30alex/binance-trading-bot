import { ParametersDto } from './parameters.dto';
import { PositionDto } from './position.dto';

export class BotStateDto {
  params: ParametersDto;
  remainingBudget: number;
  positions: Record<string, PositionDto>;
  lastReferencePrice: number | null;
  running: boolean;

  constructor() {
    this.params = new ParametersDto();
    this.remainingBudget = this.params.allocatedBudget;
    this.positions = {};
    this.lastReferencePrice = null;
    this.running = false;
  }
}
