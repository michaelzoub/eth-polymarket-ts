import {
    createPublicClient,
    createWalletClient,
    http,
    parseAbi,
    maxUint256,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";

// ==== Basic Config ====
const rpcUrl = "https://polygon-rpc.com";
const privKey = "";
const account = privateKeyToAccount(privKey);

const publicClient = createPublicClient({
    chain: polygon,
    transport: http(rpcUrl),
});

const walletClient = createWalletClient({
    account,
    chain: polygon,
    transport: http(rpcUrl),
});

// ==== ABI ====
const erc20Abi = parseAbi([
    "function approve(address spender, uint256 value) returns (bool)",
]);

const erc1155Abi = parseAbi([
    "function setApprovalForAll(address operator, bool approved)",
]);

// ==== Contract Addresses ====
const usdc = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const ctf = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045";

const targets: `0x${string}`[] = [
    "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E", // CTF Exchange
    "0xC5d563A36AE78145C45a50134d48A1215220f80a", // Neg Risk CTF Exchange
    "0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296", // Neg Risk Adapter
];

// ==== Execute approve / setApprovalForAll ====
async function main() {
    console.log(privKey, account);
    console.log(`🔑 Using account: ${account.address}`);

    for (const target of targets) {
        console.log(`🔑 Granting approvals to ${target}...`);

        // --- 1. ERC20 approve ---
        const { request: approveReq } = await publicClient.simulateContract({
            address: usdc,
            abi: erc20Abi,
            functionName: "approve",
            args: [target, maxUint256],
            account, // 👈 Must pass account to avoid zero address
        });

        const approveHash = await walletClient.writeContract(approveReq);
        const approveReceipt = await publicClient.waitForTransactionReceipt({
            hash: approveHash,
        });
        console.log("✅ USDC approve tx:", approveReceipt.transactionHash);

        // --- 2. ERC1155 setApprovalForAll ---
        const { request: setApprovalReq } = await publicClient.simulateContract(
            {
                address: ctf,
                abi: erc1155Abi,
                functionName: "setApprovalForAll",
                args: [target, true],
                account, // 👈 Must also pass account here
            }
        );

        const setApprovalHash = await walletClient.writeContract(
            setApprovalReq
        );
        const setApprovalReceipt = await publicClient.waitForTransactionReceipt(
            { hash: setApprovalHash }
        );
        console.log(
            "✅ CTF setApproval tx:",
            setApprovalReceipt.transactionHash
        );
    }
}

main().catch((err) => {
    console.error("❌ Error:", err);
});