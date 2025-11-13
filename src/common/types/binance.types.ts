// Custom type definitions for binance-api-node
export interface OrderFill {
  price: string;
  qty: string;
  commission: string;
  commissionAsset: string;
}

export interface NewOrderSpot {
  symbol: string;
  orderId: number;
  clientOrderId: string;
  transactTime: number;
  price?: string;
  origQty?: string;
  executedQty?: string;
  cummulativeQuoteQty?: string;
  status: string;
  timeInForce?: string;
  type: string;
  side: string;
  fills?: OrderFill[];
}

export interface SymbolFilter {
  filterType: string;
  minPrice?: string;
  maxPrice?: string;
  tickSize?: string;
  stepSize?: string;
  minQty?: string;
  maxQty?: string;
  minNotional?: string;
}

export interface SymbolInfo {
  symbol: string;
  status: string;
  baseAsset: string;
  baseAssetPrecision: number;
  quoteAsset: string;
  quotePrecision: number;
  quoteAssetPrecision: number;
  filters: SymbolFilter[];
}

export interface ExchangeInfo {
  symbols: SymbolInfo[];
}
