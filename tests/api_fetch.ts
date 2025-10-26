import { ApiKeyCreds, ClobClient, OrderType, Side } from "@polymarket/clob-client";
import { Wallet } from "@ethersproject/wallet";

const host = 'https://clob.polymarket.com';
const funder = '0x86d3cC7E26aBdB0AF1e1E4Eba6D075c3cA0721Ae';
const privateKey = "";
const signer = new Wallet(privateKey);

(async () => {
    const apiCreds: ApiKeyCreds = {
        key: '',
        secret: '',
        passphrase: ''
    };
    
    console.log("Signer:", await signer.getAddress());
    console.log("Funder:", funder);
    
    const clobClient = new ClobClient(host, 137, signer, apiCreds, 1, funder);
    
    const tokenID = "59484062943658251503491554436254040302845527275704850005097973842855607646090";
    
    console.log("\nAttempting to place order...");
    
    try {
        const resp = await clobClient.createAndPostOrder(
            {
                tokenID: tokenID,
                price: 0.01,  // Buy at 1 cent (well below current ask of 0.999)
                side: Side.BUY,
                size: 5,
                feeRateBps: 0,
            },
            { 
                tickSize: "0.001", 
                negRisk: false 
            },
            OrderType.GTC
        );
        
        console.log("\n✓ Order placed successfully!");
        console.log("Response:", resp);
    } catch (error: any) {
        console.error("\n❌ Error placing order:", error.message);
        if (error.response?.data) {
            console.error("Error details:", error.response.data);
        }
    }
    
})();