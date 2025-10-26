//npm install @polymarket/clob-client
//npm install ethers
//Client initialization example and dumping API Keys

import {
  ApiKeyCreds,
  ClobClient,
  OrderType,
  Side,
} from "@polymarket/clob-client";
import { Wallet } from "@ethersproject/wallet";

const host = "https://clob.polymarket.com";
const funder = "0x86d3cC7E26aBdB0AF1e1E4Eba6D075c3cA0721Ae"; // Your Polymarket proxy wallet
const signer = new Wallet(
  process.env.POLYMARKET_PRIVATE_KEY!,
); // Your Magic.link private key
const signatureType = 1; // 1 = Magic/Email Login

(async () => {
  try {
    console.log("Signer (EOA):", await signer.getAddress());
    console.log("Funder (Proxy):", funder);

    // Step 1: Create temporary client to generate API credentials
    console.log("\nGenerating API credentials...");
    const tempClient = new ClobClient(
      host,
      137,
      signer,
      undefined,
      signatureType,
      funder,
    );
    const creds = await tempClient.createOrDeriveApiKey();

    console.log("✓ API Credentials generated:");
    console.log("  Key:", creds.key);
    console.log("  Secret:", creds.secret);
    console.log("  Passphrase:", creds.passphrase);
    console.log("\n⚠️  SAVE THESE - You can reuse them later!\n");

    // Step 2: Create the main client with credentials
    const clobClient = new ClobClient(
      host,
      137,
      signer,
      creds,
      signatureType,
      funder,
    );

    // Step 3: Test by getting order book
    const tokenID =
      "32803028585408577868406458580018477946412590313011129483341370530019960345035";
    console.log("Fetching order book...");
    const orderBook = await clobClient.getOrderBook(tokenID);
    console.log("✓ Order book retrieved!");
    console.log("  Best bid:", orderBook.bids[0]?.price || "No bids");
    console.log("  Best ask:", orderBook.asks[0]?.price || "No asks");

    // Step 4: Create and post order
    console.log("\nAttempting to place order...");
    const resp = await clobClient.createAndPostOrder(
      {
        tokenID: tokenID,
        price: 0.01,
        side: Side.BUY,
        size: 5,
        feeRateBps: 0,
      },
      {
        tickSize: "0.01",
        negRisk: false,
      },
      OrderType.GTC,
    );

    console.log("\n✓ Order response:", resp);

    if (resp.success) {
      console.log("✓ Order placed successfully!");
      console.log("  Order ID:", resp.orderID);
    } else {
      console.log("❌ Order failed:", resp.errorMsg);

      if (resp.errorMsg?.includes("not enough balance")) {
        console.log("\n⚠️  You need to deposit USDC to your account!");
        console.log(`   Deposit to: ${funder}`);
      }
    }
  } catch (error: any) {
    console.error("\n❌ Error:", error.message);

    if (error.response?.data) {
      console.error("API Error:", error.response.data);
    }

    const errorStr = error.message?.toLowerCase() || "";

    if (errorStr.includes("invalid signature")) {
      console.log(
        "\n💡 Tip: This might be a NegRisk market. Try changing negRisk to true",
      );
    }

    if (errorStr.includes("not enough balance")) {
      console.log("\n⚠️  You need to deposit USDC to your account!");
      console.log(`   Deposit to: ${funder}`);
    }
  }
})();

export async function placeOrder(side, tokenId) {
  try {
    console.log("Signer (EOA):", await signer.getAddress());
    console.log("Funder (Proxy):", funder);

    // Step 1: Create temporary client to generate API credentials
    console.log("\nGenerating API credentials...");
    const tempClient = new ClobClient(
      host,
      137,
      signer,
      undefined,
      signatureType,
      funder,
    );
    const creds = await tempClient.createOrDeriveApiKey();

    console.log("✓ API Credentials generated:");
    console.log("  Key:", creds.key);
    console.log("  Secret:", creds.secret);
    console.log("  Passphrase:", creds.passphrase);
    console.log("\n⚠️  SAVE THESE - You can reuse them later!\n");

    // Step 2: Create the main client with credentials
    const clobClient = new ClobClient(
      host,
      137,
      signer,
      creds,
      signatureType,
      funder,
    );

    // Step 3: Test by getting order book
    const tokenID =
      "32803028585408577868406458580018477946412590313011129483341370530019960345035";
    console.log("Fetching order book...");
    const orderBook = await clobClient.getOrderBook(tokenID);
    console.log("✓ Order book retrieved!");
    console.log("  Best bid:", orderBook.bids[0]?.price || "No bids");
    console.log("  Best ask:", orderBook.asks[0]?.price || "No asks");

    // Step 4: Create and post order
    console.log("\nAttempting to place order...");
    const resp = await clobClient.createAndPostOrder(
      {
        tokenID: tokenId,
        price: 0.01,
        side: side,
        size: 5,
        feeRateBps: 0,
      },
      {
        tickSize: "0.01",
        negRisk: false,
      },
      OrderType.GTC,
    );

    console.log("\n✓ Order response:", resp);

    if (resp.success) {
      console.log("✓ Order placed successfully!");
      console.log("  Order ID:", resp.orderID);
    } else {
      console.log("❌ Order failed:", resp.errorMsg);

      if (resp.errorMsg?.includes("not enough balance")) {
        console.log("\n⚠️  You need to deposit USDC to your account!");
        console.log(`   Deposit to: ${funder}`);
      }
    }
  } catch (error: any) {
    console.error("\n❌ Error:", error.message);

    if (error.response?.data) {
      console.error("API Error:", error.response.data);
    }

    const errorStr = error.message?.toLowerCase() || "";

    if (errorStr.includes("invalid signature")) {
      console.log(
        "\n💡 Tip: This might be a NegRisk market. Try changing negRisk to true",
      );
    }

    if (errorStr.includes("not enough balance")) {
      console.log("\n⚠️  You need to deposit USDC to your account!");
      console.log(`   Deposit to: ${funder}`);
    }
  }
}
