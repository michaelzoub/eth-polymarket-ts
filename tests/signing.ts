import { ClobClient, OrderType, Side } from "@polymarket/clob-client";
import { Wallet } from "@ethersproject/wallet";
import { verifyMessage } from "@ethersproject/wallet";

const host = 'https://clob.polymarket.com';
const funder = '0x86d3cC7E26aBdB0AF1e1E4Eba6D075c3cA0721Ae';
const privateKey = "";
const signer = new Wallet(privateKey);
const signatureType = 1;

(async () => {
    console.log("Signer address:", await signer.getAddress());
    console.log("Funder address:", funder);
    
    // Test: Can we sign a basic message?
    const testMessage = "test message";
    const signature = await signer.signMessage(testMessage);
    console.log("\nTest signature:", signature);
    
    // Verify the signature
    const recovered = verifyMessage(testMessage, signature);
    console.log("Recovered address:", recovered);
    console.log("Signature valid:", recovered.toLowerCase() === (await signer.getAddress()).toLowerCase());
    
    // Now try with signature type 0 (EOA) instead
    console.log("\n--- Trying with signatureType 0 (EOA) ---");
    const tempClient = new ClobClient(host, 137, signer, undefined, 0, funder);
    const creds = await tempClient.createOrDeriveApiKey();
    console.log("Creds:", creds);
    
})();