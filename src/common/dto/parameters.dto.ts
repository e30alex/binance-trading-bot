export class ParametersDto {
  symbol: string;
  decreasePct: number; // percent used to trigger buys and trailing stops (as fraction, 0.02 == 2%)
  increasePct: number; // profit target (fraction)
  txAmount: number; // amount in quote currency to spend per trade (e.g. USDT)
  allocatedBudget: number; // total budget in quote currency

  constructor(
    symbol: string = 'BTCUSDT',
    decreasePct: number = 0.02,
    increasePct: number = 0.03,
    txAmount: number = 50.0,
    allocatedBudget: number = 500.0,
  ) {
    this.symbol = symbol;
    this.decreasePct = decreasePct;
    this.increasePct = increasePct;
    this.txAmount = txAmount;
    this.allocatedBudget = allocatedBudget;
  }
}
