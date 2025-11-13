import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Spot, SpotRestAPI, SPOT_REST_API_TESTNET_URL } from '@binance/spot';
import { NewOrderSpot } from '../common/types/binance.types';

@Injectable()
export class BinanceService implements OnModuleDestroy {
  private readonly logger = new Logger(BinanceService.name);
  private client: Spot;

  constructor(private configService: ConfigService) {
    this.initializeClient();
  }

  private initializeClient() {
    const apiKey = this.configService.get<string>('binance.apiKey');
    const apiSecret = this.configService.get<string>('binance.apiSecret');
    const testnet = this.configService.get<boolean>('binance.testnet');

    console.log('testnet', testnet, apiKey, apiSecret);

    if (!apiKey || !apiSecret) {
      throw new Error(
        'BINANCE_API_KEY and BINANCE_API_SECRET must be set as environment variables',
      );
    }

    const configurationRestAPI = {
      apiKey,
      apiSecret,
      ...(testnet && {
        basePath: SPOT_REST_API_TESTNET_URL,
        // basePath: 'https://demo.binance.com/',
      }),
    };

    this.client = new Spot({ configurationRestAPI });

    this.logger.log(
      `Binance client initialized (testnet: ${testnet ? 'YES' : 'NO'})`,
    );
  }

  async getCurrentPrice(symbol: string): Promise<number> {
    try {
      const response = await this.client.restAPI.tickerPrice({ symbol });
      const data = await response.data();
      // tickerPrice returns an array when symbol is specified
      const ticker = Array.isArray(data) ? data[0] : data;
      return parseFloat(ticker.price as string);
    } catch (error) {
      this.logger.error(`Error getting price for ${symbol}`, error);
      throw error;
    }
  }

  async marketBuy(
    symbol: string,
    quoteAmount: number,
  ): Promise<NewOrderSpot | null> {
    try {
      // Get symbol info to determine lot size
      const exchangeInfoResponse = await this.client.restAPI.exchangeInfo({
        symbol,
      });
      const exchangeInfo: SpotRestAPI.ExchangeInfoResponse =
        await exchangeInfoResponse.data();

      const symbolInfo = exchangeInfo.symbols?.find((s) => s.symbol === symbol);

      if (!symbolInfo) {
        this.logger.error(`Symbol ${symbol} not found`);
        return null;
      }

      // Get current price
      const price = await this.getCurrentPrice(symbol);

      // Calculate base asset quantity
      let qty = quoteAmount / price;

      // Find LOT_SIZE filter to determine step size
      const lotSizeFilter = symbolInfo.filters?.find(
        (f) => f.filterType === 'LOT_SIZE',
      );

      if (lotSizeFilter?.stepSize) {
        const stepSize = parseFloat(lotSizeFilter.stepSize);
        qty = Math.floor(qty / stepSize) * stepSize;
      }

      // Round to proper precision
      const precision =
        typeof symbolInfo.baseAssetPrecision === 'bigint'
          ? Number(symbolInfo.baseAssetPrecision)
          : symbolInfo.baseAssetPrecision || 8;
      qty = parseFloat(qty.toFixed(precision));

      if (qty <= 0) {
        this.logger.warn(`Calculated quantity is 0 or negative: ${qty}`);
        return null;
      }

      this.logger.log(
        `Placing market buy order: ${symbol}, quoteOrderQty: ${quoteAmount}`,
      );

      const orderResponse = await this.client.restAPI.newOrder({
        symbol,
        side: SpotRestAPI.NewOrderSideEnum.BUY,
        type: SpotRestAPI.NewOrderTypeEnum.MARKET,
        quoteOrderQty: Number(quoteAmount.toFixed(2)),
      });

      const order = await orderResponse.data();

      // Calculate average price for better logging
      const avgPrice =
        order.fills && order.fills.length > 0
          ? order.fills.reduce(
              (sum: number, f) =>
                sum + parseFloat(f.price || '0') * parseFloat(f.qty || '0'),
              0,
            ) / parseFloat(order.executedQty || '0')
          : 0;

      this.logger.log(
        `
          ✅ BUY ORDER EXECUTED
          Symbol: ${order.symbol}
          Order ID: ${order.orderId}
          Status: ${order.status}
          Executed Qty: ${order.executedQty}
          Total Cost: ${order.cummulativeQuoteQty} USDT
          Avg Price: ${avgPrice.toFixed(8)}
          Fills: ${order.fills?.length || 0}
        `,
      );

      return order as NewOrderSpot;
    } catch (error) {
      this.logger.error(`Error placing buy order for ${symbol}`, error);
      return null;
    }
  }

  async marketSell(
    symbol: string,
    quantity: number,
  ): Promise<NewOrderSpot | null> {
    try {
      // Get symbol info to determine lot size
      const exchangeInfoResponse = await this.client.restAPI.exchangeInfo({
        symbol,
      });
      const exchangeInfo: SpotRestAPI.ExchangeInfoResponse =
        await exchangeInfoResponse.data();

      const symbolInfo = exchangeInfo.symbols?.find((s) => s.symbol === symbol);

      if (!symbolInfo) {
        this.logger.error(`Symbol ${symbol} not found`);
        return null;
      }

      // Round quantity to proper precision
      const precision =
        typeof symbolInfo.baseAssetPrecision === 'bigint'
          ? Number(symbolInfo.baseAssetPrecision)
          : symbolInfo.baseAssetPrecision || 8;
      const qty = parseFloat(quantity.toFixed(precision));

      this.logger.log(`Placing market sell order: ${symbol}, qty: ${qty}`);

      const orderResponse = await this.client.restAPI.newOrder({
        symbol,
        side: SpotRestAPI.NewOrderSideEnum.SELL,
        type: SpotRestAPI.NewOrderTypeEnum.MARKET,
        quantity: qty,
      });

      const order = await orderResponse.data();

      // Calculate average price for better logging
      const avgPrice =
        order.fills && order.fills?.length > 0
          ? order.fills.reduce(
              (sum: number, f) =>
                sum + parseFloat(f.price || '0') * parseFloat(f.qty || '0'),
              0,
            ) / parseFloat(order.executedQty || '0')
          : 0;

      this.logger.log(
        `
        ✅ SELL ORDER EXECUTED
        Symbol: ${order.symbol}
        Order ID: ${order.orderId}
        Status: ${order.status}
        Executed Qty: ${order.executedQty}
        Total Revenue: ${order.cummulativeQuoteQty} USDT
        Avg Price: ${avgPrice.toFixed(8)}
        Fills: ${order.fills?.length || 0}
        `,
      );

      return order as NewOrderSpot;
    } catch (error) {
      this.logger.error(`Error placing sell order for ${symbol}`, error);
      return null;
    }
  }

  onModuleDestroy() {
    this.logger.log('Binance service shutting down');
  }
}
