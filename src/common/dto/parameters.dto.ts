export class ParametersDto {
  symbol: string;
  decreasePct: number; // percent used to trigger buys and trailing stops (as fraction, 0.02 == 2%)
  increasePct: number; // profit target (fraction)
  txAmount: number; // amount in quote currency to spend per trade (e.g. USDT)
  allocatedBudget: number; // total budget in quote currency
  commissionPct?: number; // Binance commission percentage (as fraction, 0.001 == 0.1%)
  maxBuyPrice?: number; // maximum price at which to allow buy orders (null/undefined = no limit)

  constructor(
    symbol: string = 'ETHUSDC',
    decreasePct: number = 0.001,
    increasePct: number = 0.007,
    txAmount: number = 200.0,
    allocatedBudget: number = 2000.0,
    commissionPct: number = 0.001, // Default 0.1%
    maxBuyPrice?: number, // Optional max price limit
  ) {
    this.symbol = symbol;
    this.decreasePct = decreasePct;
    this.increasePct = increasePct;
    this.txAmount = txAmount;
    this.allocatedBudget = allocatedBudget;
    this.commissionPct = commissionPct;
    this.maxBuyPrice = maxBuyPrice;
  }
}
