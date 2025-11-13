"""
Binance <-> Discord Trading Bot
Single-file example implementation.

Features implemented:
- Configure parameters through Discord commands:
  - setcoin <SYMBOL> (e.g. BTCUSDT)
  - set_decrease <pct_decimal> (e.g. 0.02 for 2%)
  - set_increase <pct_decimal> (e.g. 0.03 for 3%)
  - set_amount <fiat_amount> (amount per trade in quote currency e.g. USDT)
  - set_budget <fiat_amount> (total allocated budget in quote currency)
  - start / stop / status / reset
- Keeps persistent state in `bot_state.json` (parameters, budget, open positions)
- Buys when market price drops by `decrease_pct` from the last reference price
- After buy, tracks highest price and uses a trailing stop based on `decrease_pct` to
  move the stop price upward as price rises. Will only sell if the sell price would be
  >= acquisition price (ensures never sells for a loss).
- Also supports an immediate profit-target sell at `increase_pct` above purchase price.
- Enforces total budget: once consumed, no further buys.

IMPORTANT:
- This example uses the python-binance async client for Binance REST and websocket.
- Run against Binance TESTNET first (strongly recommended). DO NOT run with real funds until
  you've tested thoroughly and understand the code.

Dependencies:
  pip install python-binance==1.0.16 discord.py==2.3.2 aiohttp

Configuration:
- Provide environment variables or a config.json:
  BINANCE_API_KEY, BINANCE_API_SECRET
  DISCORD_BOT_TOKEN
- To use Binance testnet, set USE_BINANCE_TESTNET = True (below) and configure testnet keys.

Run: python binance_discord_trading_bot.py

"""

import os
import json
import asyncio
import logging
from decimal import Decimal, ROUND_DOWN
from dataclasses import dataclass, asdict, field
from typing import Optional, Dict, Any

# Binance async client
from binance import AsyncClient, BinanceSocketManager
from binance.exceptions import BinanceAPIException

# Discord
import discord
from discord.ext import commands, tasks

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("trading_bot")

STATE_FILE = "bot_state.json"
USE_BINANCE_TESTNET = True  # change to False for live trading (NOT RECOMMENDED until tested)

# --- Helper dataclasses ---
@dataclass
class Parameters:
    symbol: str = "BTCUSDT"
    decrease_pct: float = 0.02  # percent used to trigger buys and trailing stops (as fraction, 0.02 == 2%)
    increase_pct: float = 0.03  # profit target (fraction)
    tx_amount: float = 50.0     # amount in quote currency to spend per trade (e.g. USDT)
    allocated_budget: float = 500.0  # total budget in quote currency

@dataclass
class Position:
    symbol: str
    quantity: float
    buy_price: float
    highest_price: float
    entry_time: str

@dataclass
class BotState:
    params: Parameters = field(default_factory=Parameters)
    remaining_budget: float = 0.0
    positions: Dict[str, Position] = field(default_factory=dict)
    last_reference_price: Optional[float] = None
    running: bool = False

# --- Persistence ---

def load_state() -> BotState:
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE, "r") as f:
            raw = json.load(f)
            params = Parameters(**raw.get("params", {}))
            positions_raw = raw.get("positions", {})
            positions = {k: Position(**v) for k, v in positions_raw.items()}
            state = BotState(params=params,
                             remaining_budget=raw.get("remaining_budget", params.allocated_budget),
                             positions=positions,
                             last_reference_price=raw.get("last_reference_price"),
                             running=raw.get("running", False))
            return state
    else:
        st = BotState()
        st.remaining_budget = st.params.allocated_budget
        save_state(st)
        return st


def save_state(state: BotState):
    serializable = {
        "params": asdict(state.params),
        "remaining_budget": state.remaining_budget,
        "positions": {k: asdict(v) for k, v in state.positions.items()},
        "last_reference_price": state.last_reference_price,
        "running": state.running,
    }
    with open(STATE_FILE, "w") as f:
        json.dump(serializable, f, indent=2)

# --- Binance helpers ---

async def create_binance_client():
    api_key = os.getenv("BINANCE_API_KEY")
    api_secret = os.getenv("BINANCE_API_SECRET")
    if not api_key or not api_secret:
        raise RuntimeError("BINANCE_API_KEY and BINANCE_API_SECRET must be set as environment variables")

    client = await AsyncClient.create(api_key, api_secret, testnet=USE_BINANCE_TESTNET)
    return client

async def get_current_price(client: AsyncClient, symbol: str) -> float:
    # Use ticker_price endpoint
    ticker = await client.get_symbol_ticker(symbol=symbol)
    return float(ticker["price"]) if "price" in ticker else float(ticker)

async def market_buy(client: AsyncClient, symbol: str, quote_amount: float) -> Optional[Dict[str, Any]]:
    # For spot, calculate quantity using current price and round according to lot size.
    # WARNING: This code tries to approximate quantity; for production, check exchange info precisely.
    info = await client.get_symbol_info(symbol)
    price = float((await client.get_symbol_ticker(symbol=symbol))["price"])

    # compute base asset qty = quote_amount / price
    qty = Decimal(str(quote_amount)) / Decimal(str(price))

    # determine step size
    step_size = None
    for f in info["filters"]:
        if f["filterType"] == "LOT_SIZE":
            step_size = Decimal(f["stepSize"])
            break
    if not step_size:
        step_size = Decimal('0.00000001')

    # quantize quantity
    quant = int((qty / step_size).to_integral_value(rounding=ROUND_DOWN)) * step_size
    qty_f = float(quant)
    if qty_f <= 0:
        return None

    try:
        order = await client.create_order(symbol=symbol, side="BUY", type="MARKET", quoteOrderQty=str(quote_amount))
        return order
    except BinanceAPIException as e:
        logger.exception("Binance API error on buy: %s", e)
        return None

async def market_sell(client: AsyncClient, symbol: str, quantity: float) -> Optional[Dict[str, Any]]:
    try:
        order = await client.create_order(symbol=symbol, side="SELL", type="MARKET", quantity=str(quantity))
        return order
    except BinanceAPIException as e:
        logger.exception("Binance API error on sell: %s", e)
        return None

# --- Trading logic ---

class TradingBot:
    def __init__(self, state: BotState, discord_bot: commands.Bot):
        self.state = state
        self.discord_bot = discord_bot
        self.client: Optional[AsyncClient] = None
        self.bsm: Optional[BinanceSocketManager] = None
        self.price_task: Optional[asyncio.Task] = None
        self.symbol = self.state.params.symbol

    async def start(self):
        if self.state.running:
            return
        self.client = await create_binance_client()
        self.bsm = BinanceSocketManager(self.client)
        self.state.running = True
        save_state(self.state)
        logger.info("Bot started")
        self.price_task = asyncio.create_task(self.price_monitor_loop())

    async def stop(self):
        if not self.state.running:
            return
        self.state.running = False
        save_state(self.state)
        if self.price_task:
            self.price_task.cancel()
        if self.client:
            await self.client.close_connection()
        logger.info("Bot stopped")

    async def price_monitor_loop(self):
        # Simple polling loop that checks price every 2 seconds. Could be switched to websocket.
        while self.state.running:
            try:
                price = await get_current_price(self.client, self.state.params.symbol)
                await self.on_price(price)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.exception("Error in price monitor: %s", e)
            await asyncio.sleep(2)

    async def on_price(self, price: float):
        params = self.state.params
        logger.debug("Price update %s: %s", params.symbol, price)

        # initialize reference price if not set
        if self.state.last_reference_price is None:
            self.state.last_reference_price = price
            save_state(self.state)
            return

        # If there is no position open for the symbol, check buy signal
        pos = self.state.positions.get(params.symbol)
        if pos is None:
            # buy trigger: price <= last_reference_price * (1 - decrease_pct)
            if price <= self.state.last_reference_price * (1 - params.decrease_pct):
                # ensure remaining budget
                if self.state.remaining_budget >= params.tx_amount:
                    logger.info("Buy signal: price %s dropped by %.4f from reference %.4f", price, params.decrease_pct, self.state.last_reference_price)
                    order = await market_buy(self.client, params.symbol, params.tx_amount)
                    if order:
                        # determine effective price & qty from order response
                        fills = order.get("fills")
                        if fills and len(fills) > 0:
                            qty = sum(float(f["qty"]) for f in fills)
                            avg_price = sum(float(f["price"]) * float(f["qty"]) for f in fills) / qty
                        else:
                            # fallback: use executedQty and cummulativeQuoteQty
                            qty = float(order.get("executedQty", 0) or 0)
                            cqq = float(order.get("cummulativeQuoteQty", 0) or 0)
                            avg_price = cqq / qty if qty else price

                        if qty > 0:
                            pos = Position(symbol=params.symbol, quantity=qty, buy_price=avg_price, highest_price=avg_price, entry_time=asyncio.get_event_loop().time().__str__())
                            self.state.positions[params.symbol] = pos
                            self.state.remaining_budget -= params.tx_amount
                            save_state(self.state)
                            logger.info("Bought %s %s at avg price %s", qty, params.symbol, avg_price)
                        else:
                            logger.warning("Buy executed but qty=0")
                else:
                    logger.info("Insufficient budget to buy: remaining %s, required %s", self.state.remaining_budget, params.tx_amount)
            else:
                # update reference price if price moved higher gradually
                if price > self.state.last_reference_price:
                    self.state.last_reference_price = price
                    save_state(self.state)
        else:
            # We have an open position: track highest price and check trailing/profit target
            pos.highest_price = max(pos.highest_price, price)
            save_state(self.state)

            # Profit target check
            target_price = pos.buy_price * (1 + params.increase_pct)
            if price >= target_price:
                # Sell to capture profit
                logger.info("Profit target reached: selling %s at %s (target %s)", pos.quantity, price, target_price)
                order = await market_sell(self.client, pos.symbol, pos.quantity)
                if order:
                    del self.state.positions[pos.symbol]
                    save_state(self.state)
                    logger.info("Sold position for profit")
                    # reset last_reference to current price to look for next buy
                    self.state.last_reference_price = price
                    save_state(self.state)
                return

            # Trailing stop: only engage if price has risen above buy_price
            if pos.highest_price > pos.buy_price:
                trailing_stop_price = pos.highest_price * (1 - params.decrease_pct)
                logger.debug("Trailing: highest %s, stop %s, current %s", pos.highest_price, trailing_stop_price, price)
                # ensure we won't sell at a loss
                if price <= trailing_stop_price and price >= pos.buy_price:
                    logger.info("Trailing stop triggered: selling %s at %s (buy %s)", pos.quantity, price, pos.buy_price)
                    order = await market_sell(self.client, pos.symbol, pos.quantity)
                    if order:
                        del self.state.positions[pos.symbol]
                        save_state(self.state)
                        logger.info("Sold position from trailing stop")
                        self.state.last_reference_price = price
                        save_state(self.state)
            else:
                # no trailing yet; wait for price to move above buy price
                logger.debug("Pos not yet in profit; waiting for price above buy price to enable trailing")

# --- Discord commands ---

intents = discord.Intents.default()
intents.message_content = True
bot = commands.Bot(command_prefix="!", intents=intents)
state = load_state()
trading_bot = TradingBot(state, bot)

@bot.event
async def on_ready():
    logger.info(f"Discord bot ready — logged in as {bot.user}")

@bot.command()
async def setcoin(ctx, symbol: str):
    state.params.symbol = symbol.upper()
    state.last_reference_price = None
    save_state(state)
    await ctx.send(f"Symbol set to {state.params.symbol}")

@bot.command()
async def set_decrease(ctx, pct: float):
    if pct <= 0 or pct >= 1:
        await ctx.send("Please provide decrease percent as fractional value e.g. 0.02 for 2%")
        return
    state.params.decrease_pct = pct
    save_state(state)
    await ctx.send(f"Decrease/trailing percent set to {pct*100:.2f}%")

@bot.command()
async def set_increase(ctx, pct: float):
    if pct <= 0 or pct >= 1:
        await ctx.send("Please provide increase percent as fractional value e.g. 0.03 for 3%")
        return
    state.params.increase_pct = pct
    save_state(state)
    await ctx.send(f"Profit target percent set to {pct*100:.2f}%")

@bot.command()
async def set_amount(ctx, amount: float):
    if amount <= 0:
        await ctx.send("Amount must be positive")
        return
    state.params.tx_amount = amount
    save_state(state)
    await ctx.send(f"Transaction amount set to {amount}")

@bot.command()
async def set_budget(ctx, amount: float):
    if amount <= 0:
        await ctx.send("Budget must be positive")
        return
    state.params.allocated_budget = amount
    state.remaining_budget = amount
    save_state(state)
    await ctx.send(f"Allocated budget set to {amount}")

@bot.command()
async def start(ctx):
    if state.running:
        await ctx.send("Bot is already running")
        return
    await trading_bot.start()
    await ctx.send("Bot started")

@bot.command()
async def stop(ctx):
    if not state.running:
        await ctx.send("Bot is not running")
        return
    await trading_bot.stop()
    await ctx.send("Bot stopped")

@bot.command()
async def status(ctx):
    p = state.params
    msg = (
        f"Symbol: {p.symbol}\n"
        f"Decrease (trailing/buy trigger): {p.decrease_pct*100:.2f}%\n"
        f"Increase (profit target): {p.increase_pct*100:.2f}%\n"
        f"Tx amount: {p.tx_amount}\n"
        f"Allocated budget: {p.allocated_budget}\n"
        f"Remaining budget: {state.remaining_budget}\n"
        f"Positions: {list(state.positions.keys())}\n"
        f"Running: {state.running}\n"
    )
    await ctx.send(f"```{msg}```")

@bot.command()
async def reset(ctx):
    # DANGEROUS: clear positions and budget
    state.params = Parameters()
    state.remaining_budget = state.params.allocated_budget
    state.positions = {}
    state.last_reference_price = None
    state.running = False
    save_state(state)
    await ctx.send("State reset to defaults")

# --- Startup/entrypoint ---

def main():
    TOKEN = os.getenv("DISCORD_BOT_TOKEN")
    if not TOKEN:
        raise RuntimeError("DISCORD_BOT_TOKEN environment variable is required")

    loop = asyncio.get_event_loop()

    try:
        bot.run(TOKEN)
    finally:
        # ensure cleanup
        if trading_bot.client:
            loop.run_until_complete(trading_bot.client.close_connection())

if __name__ == "__main__":
    main()
