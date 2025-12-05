# Polymarket Arbitrage Bot

A latency arbitrage trading bot that exploits pricing delays between Bitcoin price movements and Polymarket prediction market adjustments.

## Overview

This bot monitors BTC price movements via the Coinbase WebSocket and automatically places orders on Polymarket when it detects significant price changes that haven't yet been reflected in prediction market odds.

## How It Works

### Signal Detection
Tracks BTC prices in real time and triggers a trade when the price moves **>10% within 15 seconds**.

### Order Execution
Places market orders on Polymarket’s BTC price prediction markets.

### Position Management
Automatically exits positions based on:
- **Profit target:** +1%
- **Stop loss:** –10% to –25% (depends on token price)

### Market Selection
Dynamically chooses the most liquid BTC price-threshold markets based on current BTC price.

## Configuration
Create a .env file:
envPOLYMARKET_PRIVATE_KEY=your_private_key
POLYMARKET_FUNDER=your_safe_wallet_address
Installation
bashnpm install
npm start

## Key Parameters

Signal Threshold: 10% price change in 15 seconds
Order Size: $5 per trade
Profit Target: 1%
Stop Loss: -10% to -25% (depending on token price)
Exit Window: 25 seconds

## Learning experience
https://x.com/wenkafka/status/1988280388997751193
