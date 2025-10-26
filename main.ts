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
//deleting old code from git!

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
}

const loadConfig = (): Config => ({
  coinbaseApiKey: process.env.COINBASE_API_KEY || "",
  coinbaseSecret: process.env.COINBASE_SECRET || "",
  coinbasePassphrase: process.env.COINBASE_PASSPHRASE || "",
  polymarketPrivateKey: process.env.POLYMARKET_PRIVATE_KEY || "",
  polymarketFunder: process.env.POLYMARKET_FUNDER || "",
  signalThresholdPercent: 0.5,
  signalWindowSeconds: 15,
  orderSize: 5.01,
  exitAfterSeconds: 25,
  signatureType: 1, //0: EOA, 1: Magic/Proxy Wallet, 2: Gnosis Safe (MetaMask, etc.)
});


class SignalDetector {
  private thresholdPercent: number;
  private windowSeconds: number;
  private priceHistory: PriceUpdate[] = [];

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

    if (percentChange > this.thresholdPercent) {
      const oldestPrice = this.priceHistory[0].price;
      const newestPrice = this.priceHistory[this.priceHistory.length - 1].price;

      const direction: "UP" | "DOWN" =
        newestPrice >= oldestPrice ? "UP" : "DOWN";

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

      const subscribe = {
        type: "subscribe",
        product_ids: ["ETH-USD"],
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
  private client: ClobClient | null = null;
  tokenId: string;
  private initialized: boolean = false;

  constructor(
    privateKey: string,
    funder: string,
    signatureType: number,
    tokenId: string,
  ) {
    const host = "https://clob.polymarket.com";
    //TODO: REMOVE BEFORE COMMITTING
    const funderPass = "0x86d3cC7E26aBdB0AF1e1E4Eba6D075c3cA0721Ae"; 
    const signer = new Wallet(
      privateKey,
    );

    this.tokenId = tokenId;
    this.initClient(host, signer, signatureType, funderPass);
  }

  private async initClient(
    host: string,
    signer: Wallet,
    signatureType: number,
    funder: string,
  ): Promise<void> {
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

  async waitForInitialization(): Promise<void> {
    while (!this.initialized) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  updateTokenId(tokenId: string): void {
    this.tokenId = tokenId;
  }

  getTokenId(): string {
    return this.tokenId;
  }

  async getMarketPrice(side: "BUY" | "SELL"): Promise<number> {
    try {
      const response = await axios.get(
        `https://clob.polymarket.com/book?token_id=${this.tokenId}`,
      );
      console.log(response);
      if (side === "BUY") {
        const bestAsk = response.data.asks?.[0]?.price;
        return bestAsk ? parseFloat(bestAsk) : 0.5;
      } else {
        const bestBid = response.data.bids?.[0]?.price;
        return bestBid ? parseFloat(bestBid) : 0.5;
      }
    } catch (error) {
      console.error("Error fetching market price:", error);
      return 0.5; 
    }
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

    const marketPrice = await this.getMarketPrice(side);
    console.log(`📊 Current market price: $${marketPrice.toFixed(2)}`);

    const orderType = OrderType.FAK; //Fill and kill over Fill or kill

    try {
      const marketOrder = await this.client!.createMarketOrder({
        side: side === "BUY" ? Side.BUY : Side.SELL,
        tokenID: this.tokenId,
        amount: amount, 
        feeRateBps: 0,
        nonce: 0,
        price: 0.5, 
      });

      console.log("✅ Created market order:", marketOrder);

      const response = await this.client!.postOrder(marketOrder, orderType);

      console.log(`✅ Order response:`, response);

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

      if (error.message?.toLowerCase().includes("invalid signature")) {
        console.log(
          "💡 Tip: Try changing negRisk to true if this is a NegRisk market",
        );
      }

      throw error;
    }
  }
}


class TradingBot {
  private config: Config;
  private polymarketClient: PolymarketClient | null = null;
  private signalDetector: SignalDetector;
  private coinbaseWs: CoinbaseWebSocket;
  private currentPosition: Position | null = null;
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

  async initialize(): Promise<void> {
    console.log("========================================");
    console.log("🚀 Starting ETH-Polymarket Arbitrage Bot");
    console.log("========================================\n");

    this.validateConfig();

    await this.updateMarketToken();

    if (!this.currentTokenId) {
      throw new Error("Failed to fetch initial token ID");
    }

    this.polymarketClient = new PolymarketClient(
      this.config.polymarketPrivateKey,
      this.config.polymarketFunder,
      this.config.signatureType,
      this.currentTokenId,
    );

    await this.polymarketClient.waitForInitialization();

    console.log(
      `\n✅ Bot initialized with token: ${this.currentTokenId.slice(0, 20)}...\n`,
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

  private async updateMarketToken(): Promise<void> {
    const afterNoon = Time.isPastNoon();
    const slug = Time.getNextMarketSlug(afterNoon);

    console.log(`========================================`);
    console.log(`⏰ Fetching market: ${slug}`);
    console.log(`========================================`);

    try {
      const tokens = await Market.fetchMarketTokens(slug);
      const ethPrice = await Market.getCurrentETHPrice();

      console.log(`💰 Current ETH Price: $${ethPrice.toFixed(2)}`);
      console.log(`📊 Available thresholds: ${Object.keys(tokens).join(", ")}`);

      const availableThresholds = Object.keys(tokens);
      const targetRange = Market.getClosestPriceRange(ethPrice, availableThresholds);

      if (targetRange && tokens[targetRange]) {
        const newTokenId = tokens[targetRange];

        const orderbookExists = await Market.verifyOrderbook(newTokenId);

        if (orderbookExists) {
          this.currentTokenId = newTokenId;
          console.log(`✅ Selected $${targetRange} threshold`);
          console.log(`   Token ID: ${this.currentTokenId.slice(0, 20)}...`);

          if (this.polymarketClient) {
            this.polymarketClient.updateTokenId(this.currentTokenId);
          }
        } else {
          console.warn(
            `⚠️  Orderbook verification failed for $${targetRange} threshold`,
          );
          await this.findAlternativeToken(tokens, ethPrice, [targetRange]);
        }
      } else {
        console.warn(`⚠️  Could not find suitable threshold`);
        await this.findAlternativeToken(tokens, ethPrice, []);
      }
    } catch (error) {
      console.error(`❌ Error updating market token:`, error);
      throw error;
    }

    console.log(`========================================\n`);
  }

  private async findAlternativeToken(tokens: MarketTokens, ethPrice: number, excludeThresholds: string[],): Promise<void> {
    console.log(`🔍 Searching for alternative token...`);

    const sortedThresholds = Object.keys(tokens)
      .filter((t) => !excludeThresholds.includes(t))
      .map((t) => ({
        threshold: t,
        distance: Math.abs(parseInt(t) - ethPrice),
      }))
      .sort((a, b) => a.distance - b.distance);

    for (const { threshold } of sortedThresholds) {
      const tokenId = tokens[threshold];
      const orderbookExists = await Market.verifyOrderbook(tokenId);

      if (orderbookExists) {
        //TODO: USE tokenId
        this.currentTokenId =
          "32803028585408577868406458580018477946412590313011129483341370530019960345035"; //tokenId;
        console.log(`✅ Alternative found: $${threshold} threshold`);
        console.log(`   Token ID: ${this.currentTokenId.slice(0, 20)}...`);

        if (this.polymarketClient) {
          this.polymarketClient.updateTokenId(this.currentTokenId);
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
        console.log(`\n🔄 Periodic market check...`);
        await this.updateMarketToken();
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
      if (timeSinceLastSignal < 30000) { // 30 seconds cooldown
        return;
      }
    }

    const signal = this.signalDetector.detectSignal();

    if (signal && !this.currentPosition && this.polymarketClient) {
      this.handleSignal(signal);
    }
  }

  private async handleSignal(signal: Signal): Promise<void> {
    this.isProcessingSignal = true;
    this.lastSignalTime = new Date();

    console.log(
      `📊 Signal detected: ${signal.direction} ${signal.percentChange.toFixed(2)}% move (${signal.previousPrice.toFixed(2)} -> ${signal.currentPrice.toFixed(2)})`,
    );

    const side: "BUY" | "SELL" = signal.direction === "UP" ? "BUY" : "SELL";

    try {
      const orderResp = await this.polymarketClient!.placeMarketOrder(side, this.config.orderSize,);

      this.PolymarketBuyAsk = await Market.getPolymarketBuyAsk(this.currentTokenId);

      if (orderResp.success && orderResp.orderID) {
        console.log(
          `✅ Order placed: ${side} ${this.config.orderSize} shares`,
        );

        this.currentPosition = {
          side,
          size: this.config.orderSize,
          entryPrice: signal.currentPrice,
          entryTime: new Date(),
          orderId: orderResp.orderID,
        };

        setTimeout(() => this.exitPosition(), this.config.exitAfterSeconds * 1000,);
      } else {
        console.error(`Failed to create position`);
        this.isProcessingSignal = false;
      }
    } catch (error) {
      console.error(`❌ Error placing order:`, error);
      this.isProcessingSignal = false;
    }
  }

  private async exitPosition(): Promise<void> {
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

    const exitSide: "BUY" | "SELL" =
      this.currentPosition.side === "BUY" ? "SELL" : "BUY";

    try {

      this.PolymarketSellBid = await Market.getPolymarketSellBid(this.currentTokenId);

      const { profit, profitPercent } = Market.calculateProfit(this.PolymarketBuyAsk!, this.PolymarketSellBid!, this.config.orderSize);

      let exitResponse;

      if (profit > 0) {
        exitResponse = await this.polymarketClient.placeMarketOrder(exitSide, this.currentPosition.size,);
        this.PolymarketSellBid = null;
        this.PolymarketBuyAsk = null;
        console.log(`Position closed: ${this.currentPosition.side} -> ${exitSide}`,);
        console.log(`Exit order ID: ${exitResponse.orderID}`);

        this.currentPosition = null;
        this.isProcessingSignal = false;
      } else {
        setTimeout(() => {
          this.exitPosition();
        }, this.config.exitAfterSeconds * 1000);
      }
    } catch (error) {
      console.error(`❌ Error exiting position:`, error);
      this.currentPosition = null;
      this.isProcessingSignal = false; 
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
//