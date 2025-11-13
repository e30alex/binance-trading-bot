# Binance Discord Trading Bot (NestJS)

A cryptocurrency trading bot built with NestJS that integrates with Binance and Discord for automated trading with trailing stop loss and profit targets.

## Features

- **Discord Integration**: Control the bot through Discord commands
- **Automated Trading Strategy**:
  - Buy when price drops by a configured percentage (e.g., 2%)
  - Sell at profit target (e.g., 3% gain)
  - Trailing stop loss that never sells at a loss
- **Budget Management**: Set and track allocated budget
- **Persistent State**: All bot state saved to JSON file
- **Testnet Support**: Test with Binance testnet before live trading

## Description

Migrated from Python to NestJS for better TypeScript support, maintainability, and enterprise-grade architecture.

## Prerequisites

- Node.js (v18 or higher)
- Yarn package manager
- Binance account with API keys (testnet recommended for testing)
- Discord bot token

## Setup

1. **Install dependencies**:

```bash
yarn install
```

2. **Configure environment variables**:

```bash
# Copy the example env file
cp .env.example .env

# Edit .env and add your credentials:
# - BINANCE_API_KEY
# - BINANCE_API_SECRET
# - DISCORD_BOT_TOKEN
# - USE_BINANCE_TESTNET (true/false)
```

3. **Get Binance API Keys**:
   - For testnet: https://testnet.binance.vision/
   - For live: https://www.binance.com/en/my/settings/api-management
   - **Important**: Start with testnet!

4. **Create and Configure Discord Bot**:

   a. **Create the application**:
   - Go to https://discord.com/developers/applications
   - Click "New Application" and give it a name
   - Go to the "Bot" section in the left sidebar
   - Click "Add Bot" or "Reset Token" to get your bot token
   - Copy the token and paste it into your `.env` file as `DISCORD_BOT_TOKEN`

   b. **Configure bot settings**:
   - In the "Bot" section, scroll down to "Privileged Gateway Intents"
   - Enable the following intents:
     - ✅ "Server Members Intent"
     - ✅ "Message Content Intent"
   - Click "Save Changes"

   c. **Generate invite URL with proper permissions**:
   - Go to "OAuth2" → "URL Generator" in the left sidebar
   - Under **SCOPES**, select:
     - ✅ `bot`
     - ✅ `applications.commands`
   - Under **BOT PERMISSIONS**, select:
     - ✅ `View Channels`
     - ✅ `Send Messages`
     - ✅ `Embed Links`
     - ✅ `Read Message History`
     - ✅ `Use Slash Commands`
   - Copy the "Generated URL" at the bottom

   d. **Invite bot to your Discord server**:
   - Paste the generated URL in your browser
   - Select the server where you want to add the bot
   - Click "Authorize"
   - Complete the CAPTCHA verification

   e. **Verify bot is in your server**:
   - Go to your Discord server
   - Click on the server name → "Server Settings" → "Members"
   - You should see your bot in the members list

   f. **Set up notification channel** (optional):
   - Create or choose a text channel for trade notifications
   - Right-click the channel → "Edit Channel" → "Permissions"
   - Click "+ Add members or roles" and add your bot
   - Grant these permissions:
     - ✅ "View Channel"
     - ✅ "Send Messages"
     - ✅ "Embed Links"
   - Once the bot is running, use `/set_channel` in that channel to enable notifications

## Running the Bot

```bash
# Development mode with auto-reload
yarn start:dev

# Production mode
yarn start:prod
```

## Quick Start Guide

Once your bot is running and connected to Discord:

1. **Configure the bot** in Discord using slash commands:
   ```
   /setcoin BTCUSDT
   /set_decrease 0.02    (2% price drop triggers buy)
   /set_increase 0.03    (3% profit target)
   /set_amount 50        (50 USDT per trade)
   /set_budget 500       (500 USDT total budget)
   ```

2. **Set up notifications** (optional):
   ```
   /set_channel    (run this in the channel where you want trade notifications)
   ```

3. **Start trading**:
   ```
   /start
   ```

4. **Check status anytime**:
   ```
   /status         (view current settings and budget)
   /history        (view open positions)
   ```

5. **Stop trading when done**:
   ```
   /stop
   ```

## Discord Commands

Once the bot is running and connected to your Discord server, use these slash commands:

| Command                   | Description                             | Example                      |
| ------------------------- | --------------------------------------- | ---------------------------- |
| `/setcoin <SYMBOL>`       | Set trading symbol                      | `/setcoin BTCUSDT`           |
| `/set_decrease <PCT>`     | Set decrease % (buy trigger & trailing) | `/set_decrease 0.02` (2%)    |
| `/set_increase <PCT>`     | Set increase % (profit target)          | `/set_increase 0.03` (3%)    |
| `/set_amount <AMOUNT>`    | Set amount per trade in quote currency  | `/set_amount 50`             |
| `/set_budget <AMOUNT>`    | Set total allocated budget              | `/set_budget 500`            |
| `/set_channel`            | Set current channel for notifications   | `/set_channel`               |
| `/start`                  | Start the trading bot                   | `/start`                     |
| `/stop`                   | Stop the trading bot                    | `/stop`                      |
| `/status`                 | View current status and settings        | `/status`                    |
| `/history`                | View open positions                     | `/history`                   |
| `/reset`                  | Reset all settings to defaults          | `/reset`                     |

**Note**: Slash commands will auto-complete as you type. Just type `/` in Discord to see all available commands.

## Trading Strategy

1. **Buy Signal**: When market price drops by `decrease_pct` from the last reference price
2. **Profit Target**: Sells when price reaches `increase_pct` above purchase price
3. **Trailing Stop**:
   - Tracks highest price after purchase
   - Sells if price drops by `decrease_pct` from highest price
   - **Never sells at a loss** - only triggers if sell price >= buy price
4. **Budget Management**: Stops buying when allocated budget is consumed

## Architecture

The application is structured into the following modules:

- **ConfigModule**: Environment variable management
- **StateModule**: JSON-based persistent state management
- **BinanceModule**: Binance API integration for trading
- **TradingModule**: Core trading logic (buy/sell strategies)
- **DiscordModule**: Discord bot and command handling

## File Structure

```
src/
├── binance/          # Binance API service
├── config/           # Configuration loader
├── discord/          # Discord bot service
├── state/            # State persistence service
├── trading/          # Trading logic service
├── common/
│   └── dto/         # Data transfer objects
└── app.module.ts    # Main application module
```

## Important Notes

- **Start with testnet**: Always test with Binance testnet before using real funds
- **Never skip testing**: The bot executes real trades - understand the code first
- **Budget management**: Set a budget you're comfortable losing while testing
- **Monitor actively**: Don't leave the bot unattended initially
- **Security**: Never commit `.env` file or share API keys

## Troubleshooting

**Bot not responding to Discord commands:**

- Ensure "Message Content Intent" is enabled in Discord developer portal
- Check bot has proper permissions in your server
- Verify DISCORD_BOT_TOKEN is correct
- Make sure you invited the bot using the OAuth2 URL with `applications.commands` scope

**Discord "Missing Access" error when sending notifications:**

- Verify the bot is in your server (check Server Settings → Members)
- Grant the bot access to the notification channel:
  - Right-click channel → "Edit Channel" → "Permissions"
  - Add your bot and enable "View Channel", "Send Messages", "Embed Links"
- Run `/set_channel` in the channel where you want notifications
- If the bot still can't access the channel, re-invite it with proper permissions (see step 4c above)

**Binance API errors:**

- Verify API keys are correct
- Check if using testnet keys with testnet URL
- Ensure API key has trading permissions enabled

**State not persisting:**

- Check file permissions for bot_state.json
- Verify BOT_STATE_FILE path in .env

**How to view testnet transactions:**

- **Binance Testnet Web UI**:
  - Go to https://testnet.binance.vision/
  - Log in with your testnet account
  - Navigate to "Orders" → "Trade History" to see all executed trades
- **Discord notifications**: Use `/set_channel` to receive trade notifications in Discord
- **Console logs**: The bot logs all trades to the terminal with detailed information
- **Local state file**: Check `bot_state.json` for current positions and budget

## Testing

```bash
# Run unit tests
yarn test

# Run tests with coverage
yarn test:cov
```

## License

UNLICENSED - Private project
