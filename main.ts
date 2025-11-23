import {
  ApiKeyCreds,
  ClobClient,
  OrderType,
  Side,
} from "@polymarket/clob-client";
import { Wallet } from "@ethersproject/wallet";
import WebSocket from "ws";
import axios from "axios";
import "dotenv/config";
import { placeOrder } from "./tests/first_order_test";
import { PolymarketMarket } from "./types/PolymarketMarket";
import { Position } from "./types/Position";
import { PriceUpdate } from "./types/PriceUpdate";
import { Signal } from "./types/Signal";
import { MarketTokens } from "./types/MarketTokens";

import Market from "./utils/Market";
import Time from "./utils/Time";
//TODO: make sure fills are GOOD and collect data for analysis.

interface OrderbookEntry {
  price: number;
  size: number;
}

//looks like index price
const coinbase_ws_url = "wss://advanced-trade-ws.coinbase.com";

interface Config {
  coinbaseApiKey: string;
  coinbaseSecret: string;
  coinbasePassphrase: string;
  polymarketPrivateKey: string;
  polymarketFunder: string;
  signalThresholdPercent: number;
  signalWindowSeconds: number;
  orderSize: number;
  exitAfterSeconds: number;
  signatureType: number;
  tokenPriceRiskThreshold: number
}

const loadConfig = (): Config => ({
  coinbaseApiKey: process.env.COINBASE_API_KEY || "",
  coinbaseSecret: process.env.COINBASE_SECRET || "",
  coinbasePassphrase: process.env.COINBASE_PASSPHRASE || "",
  polymarketPrivateKey: process.env.POLYMARKET_PRIVATE_KEY || "",
  polymarketFunder: process.env.POLYMARKET_FUNDER || "",
  signalThresholdPercent: 0.10,
  signalWindowSeconds: 15,
  orderSize: 5.0001,
  exitAfterSeconds: 25,
  signatureType: 1, //0: EOA, 1: Magic/Proxy Wallet, 2: Gnosis Safe (MetaMask, etc.)
  tokenPriceRiskThreshold: 0.2
});


class SignalDetector {
  private thresholdPercent: number;
  private windowSeconds: number;
  private priceHistory: PriceUpdate[] = [];
  private percentChanged: number | undefined;
  direction: string | undefined;

  constructor(thresholdPercent: number, windowSeconds: number) {
    this.thresholdPercent = thresholdPercent;
    this.windowSeconds = windowSeconds;
  }

  addPrice(price: PriceUpdate): void {
    this.priceHistory.push(price);

    const cutoff = new Date(Date.now() - this.windowSeconds * 1000);
    this.priceHistory = this.priceHistory.filter((p) => p.timestamp > cutoff);
  }

  detectSignal(): Signal | null {
    if (this.priceHistory.length < 2) return null;

    const prices = this.priceHistory.map((p) => p.price);
    const highestPrice = Math.max(...prices);
    const lowestPrice = Math.min(...prices);

    const percentChange = ((highestPrice - lowestPrice) / lowestPrice) * 100;
    this.percentChanged = percentChange;

    if (percentChange > this.thresholdPercent) {
      const oldestPrice = this.priceHistory[0].price;
      const newestPrice = this.priceHistory[this.priceHistory.length - 1].price;

      const direction: "UP" | "DOWN" = newestPrice >= oldestPrice ? "UP" : "DOWN";
      this.direction = direction;

      console.log("Price history array: ", this.priceHistory);

      console.log(`🔄 Detected signal: ${percentChange.toFixed(2)}%`);

      return {
        direction,
        previousPrice: lowestPrice,
        currentPrice: highestPrice,
        percentChange,
        timestamp: new Date(),
      };
    }

    return null;
  }

  getPercentChange() {
    return this.percentChanged;
  }
}


class CoinbaseWebSocket {
  private wsUrl = coinbase_ws_url;
  private ws: WebSocket | null = null;
  private priceCallback: ((price: PriceUpdate) => void) | null = null;
  private frequencyTracker: number = 0;

  start(onPrice: (price: PriceUpdate) => void): void {
    this.priceCallback = onPrice;
    this.connect();
  }

  private connect(): void {
    this.ws = new WebSocket(this.wsUrl);

    this.ws.on("open", () => {
      console.log("✅ Connected to Coinbase Advanced Trade WebSocket");

      //TODO: alternate between eth/btc depending on volume
      const subscribe = {
        type: "subscribe",
        product_ids: ["BTC-USD"],
        channel: "ticker",
      };

      this.ws?.send(JSON.stringify(subscribe));
    });

    this.ws.on("message", (data: WebSocket.Data) => {
      const msg = JSON.parse(data.toString());
      if (msg.channel === "ticker" && msg.events?.length > 0) {
        const event = msg.events[0];
        if (event.tickers?.length > 0) {
          const ticker = event.tickers[0];
          if (ticker.price) {
            this.frequencyTracker++;
            const price = parseFloat(ticker.price);
            if (this.frequencyTracker % 10 == 0) {
              console.log(price);
            }
            this.priceCallback?.({
              price,
              timestamp: new Date(),
              source: "coinbase",
            });
          }
        }
      }
    });

    this.ws.on("error", (error) => {
      console.error("WebSocket error:", error);
    });

    this.ws.on("close", () => {
      console.log("WebSocket closed, reconnecting in 2s...");
      setTimeout(() => this.connect(), 2000);
    });
  }

  close(): void {
    this.ws?.close();
  }
}


class PolymarketClient {
  client: ClobClient | null = null;
  tokenId: string;
  private initialized: boolean = false;
  private bot: TradingBot | undefined;
  tokenId_openOrder: string = "";
  private signalDetector: SignalDetector | undefined;
  takingAmount: string = "";

  constructor(privateKey: string, funder: string, signatureType: number, tokenId: string, bot?: TradingBot, signal?: SignalDetector) {
    const host = "https://clob.polymarket.com";
    const funderPass = "0x86d3cC7E26aBdB0AF1e1E4Eba6D075c3cA0721Ae"; 
    const signer = new Wallet(
      privateKey,
    );

    this.tokenId = tokenId;
    this.initClient(host, signer, signatureType, funderPass);
    this.bot = bot;
  }

  private async initClient(host: string, signer: Wallet, signatureType: number, funder: string): Promise<void> {
    try {
      const tempClient = new ClobClient(
        host,
        137,
        signer,
        undefined, 
        signatureType, 
        funder,
      );

      const creds = await tempClient.createOrDeriveApiKey();

      this.client = new ClobClient(
        host,
        137,
        signer,
        creds,
        signatureType,
        funder,
      );

      this.initialized = true;
      console.log("✅ Polymarket client initialized");
      console.log("   API Key:", creds.key.slice(0, 20) + "...");
    } catch (error) {
      console.error("❌ Failed to initialize Polymarket client:", error);
      throw error;
    }
  }

  //TODO: test out
  async sellAllShares(
    client: ClobClient,
    tokenId: string,
    totalAmount: number,
    minAcceptablePrice: number = 0
  ): Promise<void> {
    try {
      // 1️⃣ Fetch full order book
      const orderbookResp = await axios.get(`https://clob.polymarket.com/book?token_id=${tokenId}`);
      const bids: OrderbookEntry[] = (orderbookResp.data.bids || [])
        .map((b: any) => ({ price: parseFloat(b.price), size: parseFloat(b.size) }))
        .sort((a, b) => b.price - a.price); // highest first

      if (!bids.length) {
        console.warn("⚠️ No bids available, cannot sell.");
        return;
      }

      let remaining = totalAmount;

      // 2️⃣ Walk through bids
      for (const bid of bids) {
        if (remaining <= 0) break;

        // Skip if price below minimum
        if (bid.price < minAcceptablePrice) {
          console.warn(`⚠️ Bid price $${bid.price} below min acceptable $${minAcceptablePrice}, stopping sell.`);
          break;
        }

        const sellAmount = Math.min(remaining, bid.size);

        // 3️⃣ Create a FAK market order for this chunk
        const order = await client.createMarketOrder({
          side: Side.SELL,
          tokenID: tokenId,
          amount: sellAmount,
          price: bid.price,
          feeRateBps: 0,
          nonce: 0,
        });

        const response = await client.postOrder(order, OrderType.FAK);
        console.log(`✅ Sold ${sellAmount} shares at $${bid.price} — response:`, response);

        remaining -= sellAmount;
      }

      if (remaining > 0) {
        console.warn(`⚠️ Could not sell ${remaining} shares — insufficient liquidity at current bids.`);
      } else {
        console.log("✅ All shares sold successfully.");
      }
    } catch (error) {
      console.error("❌ Failed to sell all shares:", error);
    }
  }

  async waitForInitialization(): Promise<void> {
    while (!this.initialized) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  updateTokenId(tokenId: string): void {
    this.tokenId = tokenId;
    this.bot?.setCurrentTokenId(tokenId);
  }

  getTokenId(): string {
    return this.tokenId;
  }

  async placeMarketOrder(side: "BUY" | "SELL", amount: number): Promise<any> {
    await this.waitForInitialization();

    console.log(
      `🔄 Placing ${side} market order for ${amount} ${side === "BUY" ? "USD" : "shares"} (TokenID: ${this.tokenId.slice(0, 20)}...)`,
    );

    const orderbookExists = await Market.verifyOrderbook(this.tokenId);
    if (!orderbookExists) {
      throw new Error(`Orderbook does not exist for token ${this.tokenId}`);
    }

    let marketPrice = side === "BUY" ? await Market.getPolymarketBuyAsk(this.tokenId) : await Market.getPolymarketSellBid(this.tokenId);

    if (!marketPrice) {
      throw new Error(`Could not fetch market price for ${side}`);
    }

    console.log(`📊 Current market price: $${marketPrice.toFixed(4)}`);

    let orderType = OrderType.FAK; //Fill and kill over Fill or kill

    try {
      let marketOrder;
      //TODO: find out how to fully sell
      //const fills = await this.client!.getFills(orderResp.orderID);
      //const filledAmount = fills.reduce((sum, f) => sum + parseFloat(f.size), 0);
      if (side === "SELL") {
        if (this.bot?.getCurrentPosition() !== null) {
          orderType = OrderType.FAK; 
        }
        marketOrder = await this.client!.createMarketOrder({
          side: Side.SELL,
          tokenID: this.tokenId,
          amount: amount, 
          feeRateBps: 0,
          nonce: 0,
          price: marketPrice, 
        });

       // await this.sellAllShares(this.client!, this.tokenId, amount);
      } else {
        if (this.bot?.getCurrentPosition() !== null) {
          return;
        }

        //check for spread:
        const polymarketSellBid = await Market.getPolymarketSellBid(this.tokenId);
        const { profitPercent } = await Market.calculateProfit(marketPrice, polymarketSellBid!, amount);
        if (profitPercent < -15 && (polymarketSellBid! > this.bot.config.tokenPriceRiskThreshold && marketPrice > this.bot.config.tokenPriceRiskThreshold)) {
          return;
        } else if (profitPercent < -20 && side === "BUY") {
          return;
        }

        if (marketPrice > 0.6 && side === "BUY") {
          //this.PolymarketBuyAsk, this.PolymarketSellBid
          if (this.signalDetector?.direction == "UP") {
            await this.bot.updateMarketToken(true, "UP");
          } else {
            await this.bot.updateMarketToken(true, "DOWN");
          }
          this.bot.PolymarketBuyAsk = await Market.getPolymarketBuyAsk(this.tokenId);
          this.bot.PolymarketSellBid = await Market.getPolymarketSellBid(this.tokenId);
          console.log(`⚠️  Price too high: $${marketPrice.toFixed(4)} > $0.60, skipping buy`);
          //return { success: false, error: "Price above threshold" };
          marketPrice = side === "BUY" ? await Market.getPolymarketBuyAsk(this.tokenId) : await Market.getPolymarketSellBid(this.tokenId);
        } else {
          await this.bot?.updateMarketToken();
        }
        marketOrder = await this.client!.createMarketOrder({
          side: Side.BUY,
          tokenID: this.tokenId,
          amount: amount, 
          feeRateBps: 0,
          nonce: 0,
          price: marketPrice!, 
        });
      }

      console.log("✅ Created market order:", marketOrder);

      const response = await this.client!.postOrder(marketOrder, orderType);

      console.log(`✅ Order response:`, response);

      //if (side === "SELL")

      if (side === "BUY") {
        this.takingAmount = response.takingAmount;
      }

      if (response.error || response.status === 400 || response.success === false) {
        const errorMsg = response.error || response.errorMsg || 'Unknown error';
        console.error(`❌ Order failed: ${errorMsg}`);
        
        if (errorMsg?.includes("not enough balance")) {
          console.log(`⚠️  Insufficient balance. Deposit USDC to your wallet`);
        }
        
        throw new Error(`Order failed: ${errorMsg}`);
      }
      return response;
    } catch (error: any) {
      console.error(`❌ Error placing order:`, error.message);

      const errorMsg = error?.message?.toLowerCase() || "";

      // 🔁 If FOK failed due to partial fill or balance desync, try again
      if (side === "SELL" && (
        errorMsg.includes("not enough balance") ||
        errorMsg.includes("allowance") ||
        errorMsg.includes("failed") ||
        errorMsg.includes("insufficient")
      )) {
        console.warn("⚠️ Detected partial fill or balance desync — entering retry loop...");
      }

      if (error.message?.toLowerCase().includes("invalid signature")) {
        console.log("💡 Tip: Try changing negRisk to true if this is a NegRisk market");
      }

      // Re-throw to let exitPosition handle higher-level cleanup if needed
      throw error;
    }
  }
}


class TradingBot {
  config: Config;
  private polymarketClient: PolymarketClient | null = null;
  private signalDetector: SignalDetector;
  private coinbaseWs: CoinbaseWebSocket;
  private currentPosition: Position | null = null;
  private currentYesTokenId: string = "";
  private currentNoTokenId: string = "";
  private currentTokenId: string = "";
  private marketUpdateInterval: NodeJS.Timeout | null = null;
  private isProcessingSignal = false;
  private lastSignalTime: Date | null = null; 
  PolymarketBuyAsk: number | null = 0;
  PolymarketSellBid: number | null = 0;

  constructor(config: Config) {
    this.config = config;
    this.signalDetector = new SignalDetector(
      config.signalThresholdPercent,
      config.signalWindowSeconds,
    );
    this.coinbaseWs = new CoinbaseWebSocket();
  }

//   private async getTokenBalance(tokenId: string): Promise<number> {
//   try {
//     // Get balance from Polymarket CLOB API
//     const balances = await this.polymarketClient?.client?.getBalances();
    
//     // Find the specific token balance
//     const tokenBalance = balances?.find((b: any) => b.asset_id === tokenId);
    
//     return parseFloat(tokenBalance?.amount || "0");
//   } catch (error) {
//     console.error("Error fetching token balance:", error);
//     return this.currentPosition?.size || 0;
//   }
// }

  getCurrentPosition() {
    return this.currentPosition;
  }

  setCurrentTokenId(tokenId: string) {
    this.currentTokenId = tokenId;
  }

  async initialize(): Promise<void> {
    console.log("========================================");
    console.log("🚀 Starting ETH-Polymarket Arbitrage Bot");
    console.log("========================================\n");
    this.validateConfig();

    await this.updateMarketToken();

    if (!this.currentYesTokenId || !this.currentNoTokenId) {
      throw new Error("Failed to fetch initial token IDs");
    }

    this.polymarketClient = new PolymarketClient(
      this.config.polymarketPrivateKey,
      this.config.polymarketFunder,
      this.config.signatureType,
      this.currentYesTokenId,//TODO: why is this here
      this,
      this.signalDetector
    );

    await this.polymarketClient.waitForInitialization();

    console.log(
      `\n✅ Bot initialized with YES token: ${this.currentYesTokenId.slice(0, 20)}...\n`,
    );
  }

  private validateConfig(): void {
    console.log("🔍 Validating configuration...\n");

    if (!this.config.polymarketPrivateKey) {
      throw new Error("POLYMARKET_PRIVATE_KEY is required in .env");
    }

    if (!this.config.polymarketFunder) {
      throw new Error(
        "POLYMARKET_FUNDER is required in .env - this should be your Polymarket Safe wallet address",
      );
    }

    if (!this.config.polymarketPrivateKey.startsWith("0x")) {
      console.warn("⚠️  Private key doesn't start with 0x, adding it...");
      this.config.polymarketPrivateKey =
        "0x" + this.config.polymarketPrivateKey;
    }

    if (
      !this.config.polymarketFunder.startsWith("0x") ||
      this.config.polymarketFunder.length !== 42
    ) {
      throw new Error(
        "POLYMARKET_FUNDER must be a valid Ethereum address (0x...)",
      );
    }

    const signer = new Wallet(this.config.polymarketPrivateKey);
    console.log(`✅ Signer address (EOA): ${signer.address}`);
    console.log(`✅ Funder address (Safe): ${this.config.polymarketFunder}`);
    console.log(
      `✅ Signature type: ${this.config.signatureType} (0=EOA, 1=Proxy/Magic, 2=Gnosis Safe)\n`,
    );

    if (signer.address.toLowerCase() === this.config.polymarketFunder.toLowerCase()) {
      console.warn("⚠️  WARNING: Signer and Funder are the same address!");
      console.warn(
        "   For Polymarket browser wallets, Funder should be your Safe wallet address",
      );
      console.warn(
        "   and Signer should be your EOA that controls the Safe.\n",
      );
    }
  }

  async updateMarketToken(skipMarket?: boolean, direction?: string): Promise<void> {
    const afterNoon = Time.isPastNoon();
    const slug = Time.getNextMarketSlug(afterNoon);

    console.log(`========================================`);
    console.log(`⏰ Fetching market: ${slug}`);
    console.log(`========================================`);

    try {
      const tokens = await Market.fetchMarketTokens(slug);
      const ethPrice = await Market.getCurrentETHPrice();
      const btcPrice = await Market.getCurrentBTCPrice();

      console.log(`💰 Current BTC Price: $${btcPrice.toFixed(2)}`);
      console.log(`📊 Available thresholds: ${Object.keys(tokens).join(", ")}`);

      const availableThresholds = Object.keys(tokens);
      let targetRange;

      if (skipMarket) {
        //TODO: check if makes sense in the future
        targetRange = Market.getClosestPriceRange(btcPrice + (direction == "UP" ? 2000 : -2000), availableThresholds, "BTC");
      } else {
        targetRange = Market.getClosestPriceRange(btcPrice, availableThresholds, "BTC");
      }

      if (targetRange && tokens[targetRange]) {
        const tokenPair = tokens[targetRange];
        const yesTokenId = tokenPair.yes;
        const noTokenId = tokenPair.no;

        const orderbookExists = await Market.verifyOrderbook(yesTokenId);

        if (orderbookExists) {
          this.currentYesTokenId = yesTokenId;
          this.currentNoTokenId = noTokenId;
          console.log(`✅ Selected $${targetRange} threshold`);
          console.log(`   YES Token ID: ${this.currentYesTokenId.slice(0, 20)}...`);
          console.log(`   NO Token ID: ${this.currentNoTokenId.slice(0, 20)}...`);

          if (this.polymarketClient) {
            //yes/no doesn't matter at first
            console.log("DIRECTION BEFORE UPDATING: ", direction);
            if (direction == "UP") {
              this.polymarketClient.updateTokenId(this.currentYesTokenId);
            } else if (direction === "DOWN") {
              this.polymarketClient.updateTokenId(this.currentNoTokenId);
            } else {
              this.polymarketClient.updateTokenId(this.currentYesTokenId);
            }
          }
        } else {
          console.warn(
            `⚠️  Orderbook verification failed for $${targetRange} threshold`,
          );
          await this.findAlternativeToken(tokens, btcPrice, [targetRange]);
        }
      } else {
        console.warn(`⚠️  Could not find suitable threshold`);
        await this.findAlternativeToken(tokens, btcPrice, []);
      }
    } catch (error) {
      console.error(`❌ Error updating market token:`, error);
      throw error;
    }

    console.log(`========================================\n`);
  }

  private async findAlternativeToken(tokens: MarketTokens, price: number, excludeThresholds: string[]): Promise<void> {
    console.log(`🔍 Searching for alternative token...`);

    const sortedThresholds = Object.keys(tokens)
      .filter((t) => !excludeThresholds.includes(t))
      .map((t) => ({
        threshold: t,
        distance: Math.abs(parseInt(t) - price),
      }))
      .sort((a, b) => a.distance - b.distance);

    for (const { threshold } of sortedThresholds) {
      const tokenPair = tokens[threshold];
      const orderbookExists = await Market.verifyOrderbook(tokenPair.yes);

      if (orderbookExists) {
        this.currentYesTokenId = tokenPair.yes;
        this.currentNoTokenId = tokenPair.no;
        console.log(`✅ Alternative found: $${threshold} threshold`);
        console.log(`   YES Token ID: ${this.currentYesTokenId.slice(0, 20)}...`);
        console.log(`   NO Token ID: ${this.currentNoTokenId.slice(0, 20)}...`);

        if (this.polymarketClient) {
          //this doesn't matter either, TODO: could probably remove both of these updateTokenIds
          this.polymarketClient.updateTokenId(this.currentYesTokenId);
        }
        return;
      }
    }

    console.error(`❌ No valid orderbooks found in available markets`);
  }

  start(): void {

    this.coinbaseWs.start((priceUpdate) => {
      this.signalDetector.addPrice(priceUpdate);
      this.checkForSignal();
    });

    this.marketUpdateInterval = setInterval(
      async () => {
        //TODO add if else clause (if order open dont sell)
        console.log(`\n🔄 Periodic market check...`);
        //await this.updateMarketToken();
      },
      60 * 60 * 1000,
    );

    console.log("✅ Bot started and monitoring for signals...\n");
  }
  private checkForSignal(): void {
    if (this.isProcessingSignal) {
      return;
    }

    if (this.lastSignalTime) {
      const timeSinceLastSignal = Date.now() - this.lastSignalTime.getTime();
      if (timeSinceLastSignal < 30000) { 
        return;
      }
    }

    const signal = this.signalDetector.detectSignal();

    if (signal && !this.currentPosition && this.polymarketClient) {
      this.handleSignal(signal);
    }
  }

  private async handleSignal(signal: Signal): Promise<void> {
    if (this.isProcessingSignal) {
      console.log("⚙️ Still processing previous signal, skipping...");
      return;
    }
    this.isProcessingSignal = true;
    this.lastSignalTime = new Date();

    //TODO: make it more understandable for down prices
    console.log(
      `📊 Signal detected: ${signal.direction} ${signal.percentChange.toFixed(2)}% move (${signal.previousPrice.toFixed(2)} -> ${signal.currentPrice.toFixed(2)})`,
    );

    const side: "BUY" | "SELL" = signal.direction === "UP" ? "BUY" : "SELL";
    const tokenId = signal.direction === "UP" ? this.currentYesTokenId : this.currentNoTokenId;
    this.currentTokenId = tokenId;

    try {
      this.polymarketClient!.updateTokenId(tokenId);
      //this.currentPosition.size += 100.0;
      const orderResp = await this.polymarketClient!.placeMarketOrder("BUY", this.config.orderSize);

      this.PolymarketBuyAsk = await Market.getPolymarketBuyAsk(tokenId);

      if (orderResp.success && orderResp.orderID) {
        console.log(
          `✅ Order placed: ${side} ${this.config.orderSize} shares at $${this.PolymarketBuyAsk?.toFixed(4)}`,
        );

        this.currentPosition = {
          side,
          size: this.config.orderSize,
          entryPrice: signal.currentPrice,
          entryTime: new Date(),
          orderId: orderResp.orderID,
        };

        //TODO check every 5 seconds if in profit
        setTimeout(() => {
          this.exitPosition();
        }, 5000);
      } else {
        console.error(`Failed to create position`);
        this.isProcessingSignal = false;
      }
    } catch (error) {
      console.error(`❌ Error placing order:`, error);
      this.isProcessingSignal = false;
    }
  }

  async exitPosition(): Promise<void> {
    if (!this.currentPosition) {
      console.log("⚠️  No position to exit");
      this.isProcessingSignal = false;
      return;
    }
    
    if (!this.polymarketClient) {
      console.log("⚠️  Polymarket client not initialized");
      this.currentPosition = null;
      this.isProcessingSignal = false; 
      return;
    }

    //const currentTokenId = this.currentPosition.side === "BUY" ? this.currentYesTokenId : this.currentNoTokenId;
    //const currentTokenId = this.polymarketClient.tokenId;
    this.PolymarketSellBid = await Market.getPolymarketSellBid(this.currentTokenId);

    try {

      if (!this.PolymarketBuyAsk || !this.PolymarketSellBid) {
        console.warn("⚠️  Missing price data, retrying...");
        setTimeout(() => this.exitPosition(), 5000);
        return;
      }

      const { profit, profitPercent } = Market.calculateProfit(this.PolymarketBuyAsk, this.PolymarketSellBid, this.config.orderSize);

      //this.polymarketClient.updateTokenId(this.currentPosition.tokenId);
      let exitResponse;

      console.log(`💰 Profit: $${profit.toFixed(4)} (${profitPercent.toFixed(2)}%)`);
      console.log(`   Entry (ask): $${this.PolymarketBuyAsk.toFixed(4)}`);
      console.log(`   Exit (bid): $${this.PolymarketSellBid.toFixed(4)}`);

      const PROFIT_PERCENT = 1; //5% profit target
      //TODO: added check to see if buy and sell are big.
      const STOPLOSS_PERCENT = (this.PolymarketBuyAsk > this.config.tokenPriceRiskThreshold && this.PolymarketSellBid > this.config.tokenPriceRiskThreshold) ? -10 : -25; //Stop loss at -5%

      console.log("TAKING AMOUNT: ", this.polymarketClient.takingAmount);
      if (profitPercent >= PROFIT_PERCENT) {
        //TODO: get all shares
        exitResponse = await this.polymarketClient.placeMarketOrder("SELL", Number(this.polymarketClient.takingAmount));
        //this.currentPosition
        //exitResponse.makingAmount == what i'm SELLING
        const difference = Number(this.polymarketClient.takingAmount) - exitResponse.makingAmount;
        if ((difference * this.PolymarketSellBid) > 0.5) {
          this.polymarketClient.takingAmount = difference.toString();
          setTimeout(() => {
            console.log(`⚠️ ${difference.toFixed(4)} shares unfilled, retrying in 2.5s...`);
            this.exitPosition();
          }, 2500);
          return; 
        }
        this.PolymarketSellBid = null;
        this.PolymarketBuyAsk = null;
        console.log(`✅ Position closed: ${this.currentPosition.side}`);
        console.log(`   Exit order ID: ${exitResponse.orderID}`);

        this.currentPosition = null;
        this.isProcessingSignal = false;
      }  else if (profitPercent <= STOPLOSS_PERCENT) {
        console.log(`⛔ Stop loss triggered: ${profitPercent.toFixed(2)}% ($${profit.toFixed(4)})`);
        //this.currentPosition.size += 100.0;
        exitResponse = await this.polymarketClient.placeMarketOrder("SELL", Number(this.polymarketClient.takingAmount));
        this.PolymarketSellBid = null;
        this.PolymarketBuyAsk = null;
        console.log(`✅ Position closed: ${this.currentPosition.side}`);
        console.log(`   Exit order ID: ${exitResponse.orderID}`);

        this.currentPosition = null;
        this.isProcessingSignal = false;
      } else {
        setTimeout(() => {
          this.exitPosition();
        }, 5000); //5 seconds
      }
    } catch (error) {
      console.error(`❌ Error exiting position:`, error);
      if (this.currentPosition) {
        setTimeout(() => this.exitPosition(), 5000);
      }
      //this.currentPosition = null;
      //this.isProcessingSignal = false; 
    }
  }

  stop(): void {
    this.coinbaseWs.close();

    if (this.marketUpdateInterval) {
      clearInterval(this.marketUpdateInterval);
    }

    console.log("Bot stopped");
  }
}


async function main() {
  const config = loadConfig();
  const bot = new TradingBot(config);

  await bot.initialize();
  bot.start();

  process.on("SIGINT", () => {
    console.log("\n🛑 Shutdown signal received, closing...");
    bot.stop();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("\n🛑 Shutdown signal received, closing...");
    bot.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("💥 Fatal error:", error);
  process.exit(1);
});