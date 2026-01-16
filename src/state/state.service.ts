import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { BotStateDto } from '../common/dto/bot-state.dto';
import { ParametersDto } from '../common/dto/parameters.dto';
import { PositionDto } from '../common/dto/position.dto';

interface RawStateJson {
  params?: {
    symbol?: string;
    decreasePct?: number;
    increasePct?: number;
    txAmount?: number;
    allocatedBudget?: number;
  };
  positions?: Record<
    string,
    | {
        symbol: string;
        quantity: number;
        buyPrice: number;
        highestPrice: number;
        entryTime: string;
        lastBuyPrice?: number;
        totalInvested?: number;
      }
    | {
        symbol: string;
        quantity: number;
        buyPrice: number;
        highestPrice: number;
        entryTime: string;
        lastBuyPrice?: number;
        totalInvested?: number;
      }[]
  >;
  remainingBudget?: number;
  lastReferencePrice?: number | null;
  lastPositionBuyPrice?: number | null;
  sessionProfit?: number;
  running?: boolean;
}

@Injectable()
export class StateService {
  private readonly logger = new Logger(StateService.name);
  private readonly stateFile: string;
  private state: BotStateDto;

  constructor(private configService: ConfigService) {
    this.stateFile =
      this.configService.get<string>('bot.stateFile') || 'bot_state.json';
    this.state = this.loadState();
  }

  private loadState(): BotStateDto {
    const stateFilePath = path.resolve(process.cwd(), this.stateFile);

    if (fs.existsSync(stateFilePath)) {
      try {
        const raw = JSON.parse(
          fs.readFileSync(stateFilePath, 'utf-8'),
        ) as RawStateJson;

        const params = new ParametersDto(
          raw.params?.symbol,
          raw.params?.decreasePct,
          raw.params?.increasePct,
          raw.params?.txAmount,
          raw.params?.allocatedBudget,
        );

        const positions: Record<string, PositionDto[]> = {};
        if (raw.positions) {
          Object.keys(raw.positions).forEach((key) => {
            const rawPosOrArray = raw.positions?.[key];

            if (!rawPosOrArray) return;

            const toDto = (p: {
              symbol: string;
              quantity: number;
              buyPrice: number;
              highestPrice: number;
              entryTime: string;
              lastBuyPrice?: number;
              totalInvested?: number;
            }) =>
              new PositionDto(
                p.symbol,
                p.quantity,
                p.buyPrice,
                p.highestPrice,
                p.entryTime,
                p.lastBuyPrice ?? p.buyPrice,
                p.totalInvested ?? p.quantity * p.buyPrice,
              );

            if (Array.isArray(rawPosOrArray)) {
              positions[key] = rawPosOrArray.map(toDto);
            } else {
              // Backward compatibility: single position object becomes a 1-element array
              positions[key] = [toDto(rawPosOrArray)];
            }
          });
        }

        const state = new BotStateDto();
        state.params = params;
        state.remainingBudget = raw.remainingBudget ?? params.allocatedBudget;
        state.positions = positions;
        state.lastReferencePrice = raw.lastReferencePrice ?? null;
        state.lastPositionBuyPrice = raw.lastPositionBuyPrice ?? null;
        state.sessionProfit = raw.sessionProfit ?? 0;
        state.running = raw.running ?? false;

        this.logger.log('State loaded from file');
        return state;
      } catch (error) {
        this.logger.error('Error loading state file, using defaults', error);
        return this.createDefaultState();
      }
    } else {
      this.logger.log('No state file found, creating default state');
      const state = this.createDefaultState();
      this.saveState(state);
      return state;
    }
  }

  private createDefaultState(): BotStateDto {
    const state = new BotStateDto();
    state.remainingBudget = state.params.allocatedBudget;
    return state;
  }

  saveState(state?: BotStateDto): void {
    const stateToSave = state || this.state;
    const stateFilePath = path.resolve(process.cwd(), this.stateFile);

    const serializable = {
      params: stateToSave.params,
      remainingBudget: stateToSave.remainingBudget,
      positions: stateToSave.positions,
      lastReferencePrice: stateToSave.lastReferencePrice,
      lastPositionBuyPrice: stateToSave.lastPositionBuyPrice,
      sessionProfit: stateToSave.sessionProfit,
      running: stateToSave.running,
    };

    try {
      // Use replacer to preserve up to 10 decimal places for numbers
      const replacer = (_key: string, value: unknown) => {
        if (typeof value === 'number') {
          // Preserve up to 10 decimal places
          return parseFloat(value.toFixed(10));
        }
        return value;
      };
      fs.writeFileSync(
        stateFilePath,
        JSON.stringify(serializable, replacer, 2),
      );
      this.logger.debug('State saved to file');
    } catch (error) {
      this.logger.error('Error saving state file', error);
    }
  }

  getState(): BotStateDto {
    return this.state;
  }

  setState(state: BotStateDto): void {
    this.state = state;
    this.saveState();
  }

  updateState(updates: Partial<BotStateDto>): void {
    this.state = { ...this.state, ...updates };
    this.saveState();
  }
}
