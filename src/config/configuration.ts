export default () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  binance: {
    apiKey: process.env.BINANCE_API_KEY,
    apiSecret: process.env.BINANCE_API_SECRET,
    testnet: process.env.USE_BINANCE_TESTNET === 'true',
  },
  discord: {
    botToken: process.env.DISCORD_BOT_TOKEN,
    notificationChannelId: process.env.DISCORD_NOTIFICATION_CHANNEL_ID,
  },
  bot: {
    stateFile: process.env.BOT_STATE_FILE || 'bot_state.json',
  },
});
