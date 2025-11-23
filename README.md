Polymarket Arbitrage Bot
A latency arbitrage trading bot that exploits pricing delays between Bitcoin price movements and Polymarket prediction market adjustments.
Overview
This bot monitors BTC price movements via Coinbase WebSocket and automatically places orders on Polymarket when it detects significant price changes that haven't yet been reflected in the prediction market odds.
How It Works

Signal Detection: Tracks BTC prices via WebSocket, triggers when price moves >10% within 15 seconds
Order Execution: Places market orders on Polymarket's BTC price prediction markets
Position Management: Automatically exits positions based on profit targets (+1%) or stop losses (-10% to -25%)
Market Selection: Dynamically selects the most liquid price threshold markets based on current BTC price

Configuration
Create a .env file:
envPOLYMARKET_PRIVATE_KEY=your_private_key
POLYMARKET_FUNDER=your_safe_wallet_address
Installation
bashnpm install
npm start
Key Parameters

Signal Threshold: 10% price change in 15 seconds
Order Size: $5 per trade
Profit Target: 1%
Stop Loss: -10% to -25% (depending on token price)
Exit Window: 25 seconds
