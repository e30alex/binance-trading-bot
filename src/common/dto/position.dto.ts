export class PositionDto {
  symbol: string;
  quantity: number;
  buyPrice: number; // Weighted average buy price
  highestPrice: number;
  entryTime: string;
  lastBuyPrice?: number; // Price of the most recent buy (for multiple buy tracking)
  totalInvested?: number; // Total amount invested in USDT

  constructor(
    symbol: string,
    quantity: number,
    buyPrice: number,
    highestPrice: number,
    entryTime: string,
    lastBuyPrice: number = buyPrice,
    totalInvested: number = 0,
  ) {
    this.symbol = symbol;
    this.quantity = quantity;
    this.buyPrice = buyPrice;
    this.highestPrice = highestPrice;
    this.entryTime = entryTime;
    this.lastBuyPrice = lastBuyPrice;
    this.totalInvested = totalInvested;
  }
}
