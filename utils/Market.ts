import { MarketTokens } from "../types/MarketTokens";
import { PolymarketMarket } from "../types/PolymarketMarket";
import axios from "axios";

export default new class Market {
  async fetchMarketTokens(slug: string): Promise<MarketTokens> {
    const url = `https://gamma-api.polymarket.com/events/slug/${slug}`;
  
    try {
      const response = await axios.get(url);
  
      if (!response.data || !response.data.markets) {
        throw new Error(`Invalid response from Gamma API for slug: ${slug}`);
      }
  
      const tokens: MarketTokens = {};
  
      for (const market of response.data.markets as PolymarketMarket[]) {
        // Skip inactive or closed markets
        if (!market.active || market.closed) {
          console.log(`⚠️  Skipping inactive market: ${market.question}`);
          continue;
        }
  
        try {
          const tokenIds = JSON.parse(market.clobTokenIds);
          const parts = market.question.split("$");
  
          if (parts.length >= 2) {
            const threshold = parts[1].split(" ")[0].replace(/,/g, "");
            tokens[threshold] = tokenIds[0]; // YES token
            console.log(`   Found threshold $${threshold}: ${tokenIds[0]}`);
          }
        } catch (parseError) {
          console.error(`⚠️  Error parsing market data:`, parseError);
        }
      }
  
      if (Object.keys(tokens).length === 0) {
        throw new Error(`No active markets found for slug: ${slug}`);
      }
  
      return tokens;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          `❌ API Error fetching market ${slug}:`,
          error.response?.status,
          error.response?.data,
        );
      } else {
        console.error(`❌ Error fetching market ${slug}:`, error);
      }
      throw error;
    }
  };
    
  async getCurrentETHPrice(): Promise<number> {
    const response = await axios.get(
      "https://api.coinbase.com/v2/prices/ETH-USD/spot",
    );
    return parseFloat(response.data.data.amount);
  };
    
  getClosestPriceRange(currentPrice: number, availableThresholds: string[]): string | null {
    const lowerBound = Math.floor(currentPrice / 100) * 100;
    const upperBound = lowerBound + 100;

    const tolerance = currentPrice * (0.5 / 100); //0.5% x ETH price
  
    const distanceToLower = currentPrice - lowerBound;
    const distanceToUpper = upperBound - currentPrice;

    let candidates: string[] = [];
  
    if (distanceToLower <= tolerance) {
      candidates.push((lowerBound - 100).toString());
    }
  
    if (distanceToUpper <= tolerance) {
      candidates.push(upperBound.toString());
    }
    //this assumes we prefer to long and take on more risk, try to find way to make it more profitable or avoid betting altogether when we aren't sure if its safe
    if (candidates.length === 0) {
      candidates.push(lowerBound.toString());
    }

    for (const candidate of candidates) {
      if (availableThresholds.includes(candidate)) {
        return candidate;
      }
    }

    const sortedThresholds = availableThresholds
      .map((t) => parseInt(t))
      .sort((a, b) => Math.abs(a - currentPrice) - Math.abs(b - currentPrice));
  
    return sortedThresholds.length > 0 ? sortedThresholds[0].toString() : null;
  };
    
  async verifyOrderbook(tokenId: string): Promise<boolean> {
    try {
      const response = await axios.get(
        `https://clob.polymarket.com/book?token_id=${tokenId}`,
      );
  
      if (response.data && (response.data.bids || response.data.asks)) {
        console.log(`✅ Orderbook verified for token ${tokenId.slice(0, 20)}...`);
        return true;
      }
  
      console.warn(`⚠️  Empty orderbook for token ${tokenId.slice(0, 20)}...`);
      return false;
    } catch (error) {
      console.error(
        `❌ Orderbook verification failed for token ${tokenId.slice(0, 20)}...`,
      );
      return false;
    }
  };

  async getPolymarketBuyAsk(tokenId: string): Promise<number | null> {
      try {
      const response = await axios.get(
          `https://clob.polymarket.com/book?token_id=${tokenId}`,
      );

      if (response.data?.asks && response.data.asks.length > 0) {
          const bestAsk = parseFloat(response.data.asks[0].price);
          console.log(`💰 Best ask (buy price): $${bestAsk.toFixed(2)}`);
          return bestAsk;
      }

      console.warn(`⚠️  No asks available for token ${tokenId.slice(0, 20)}...`);
      return null;
      } catch (error) {
      console.error(`❌ Failed to fetch ask price for token ${tokenId.slice(0, 20)}...`);
      return null;
      }
  }

  async getPolymarketSellBid(tokenId: string): Promise<number | null> {
    try {
      const response = await axios.get(
        `https://clob.polymarket.com/book?token_id=${tokenId}`,
      );

      if (response.data?.bids && response.data.bids.length > 0) {
        const bestBid = parseFloat(response.data.bids[0].price);
        console.log(`💰 Best bid (sell price): $${bestBid.toFixed(2)}`);
        return bestBid;
      }

      console.warn(`⚠️  No bids available for token ${tokenId.slice(0, 20)}...`);
      return null;
    } catch (error) {
      console.error(`❌ Failed to fetch bid price for token ${tokenId.slice(0, 20)}...`);
      return null;
    }
  }

  /**
   * Calculate profit/loss for a round-trip trade
   * @param buyPrice - Price you bought at (ask price)
   * @param sellPrice - Price you can sell at (bid price)
   * @param shares - Number of shares traded
   * @returns Profit/loss in dollars
   */
  calculateProfit(buyPrice: number, sellPrice: number, shares: number,): { profit: number; profitPercent: number } {
    const costBasis = buyPrice * shares;
    const saleProceeds = sellPrice * shares;
    const profit = saleProceeds - costBasis;
    const profitPercent = (profit / costBasis) * 100;

    return { profit, profitPercent };
  }
}
