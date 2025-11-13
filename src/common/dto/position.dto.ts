export class PositionDto {
  symbol: string;
  quantity: number;
  buyPrice: number;
  highestPrice: number;
  entryTime: string;

  constructor(
    symbol: string,
    quantity: number,
    buyPrice: number,
    highestPrice: number,
    entryTime: string,
  ) {
    this.symbol = symbol;
    this.quantity = quantity;
    this.buyPrice = buyPrice;
    this.highestPrice = highestPrice;
    this.entryTime = entryTime;
  }
}
