/**
 * Devnet Faucet + Transaction Verification Script
 *
 * 1. Requests faucet SOL for the configured wallet
 * 2. Verifies connection and fetches balance
 * 3. Fetches pool account if it exists
 *
 * Run: npx ts-node scripts/devnet-faucet-test.ts
 * Or:  ANCHOR_PROVIDER_URL=https://api.devnet.solana.com ANCHOR_WALLET=~/.config/solana/id.json npx ts-node scripts/devnet-faucet-test.ts
 */

import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

const RPC = process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID || "9ZcVkMmP4DGsgJZuN6GSUVNhyacvzQwFh1M8kAq15Cie"
);
const UST_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_UST_MINT || "11111111111111111111111111111111"
);
const POOL_SEED = Buffer.from("global_pool");

async function loadWallet(): Promise<Keypair> {
  const walletPath = process.env.ANCHOR_WALLET || path.join(process.env.HOME || "", ".config/solana/id.json");
  const resolved = walletPath.startsWith("~")
    ? path.join(process.env.HOME || "", walletPath.slice(1))
    : walletPath;
  const keypair = JSON.parse(fs.readFileSync(resolved, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(keypair));
}

async function main() {
  const connection = new Connection(RPC, "confirmed");
  console.log("Connecting to:", RPC);

  const wallet = await loadWallet();
  console.log("Wallet:", wallet.publicKey.toBase58());

  let balance = await connection.getBalance(wallet.publicKey);
  console.log("Balance before airdrop:", balance / LAMPORTS_PER_SOL, "SOL");

  if (balance < 0.5 * LAMPORTS_PER_SOL) {
    const amounts = [0.5 * LAMPORTS_PER_SOL, LAMPORTS_PER_SOL];
    for (const lamports of amounts) {
      try {
        console.log("Requesting airdrop (", lamports / LAMPORTS_PER_SOL, " SOL)...");
        const sig = await connection.requestAirdrop(wallet.publicKey, lamports);
        await connection.confirmTransaction(sig, "confirmed");
        balance = await connection.getBalance(wallet.publicKey);
        console.log("Airdrop success. Balance:", balance / LAMPORTS_PER_SOL, "SOL");
        break;
      } catch (e: unknown) {
        console.warn("Airdrop failed:", (e as Error).message);
        if (lamports === amounts[amounts.length - 1]) {
          console.log("\nDevnet faucet may be rate-limited. Get SOL manually:");
          console.log("  https://faucet.solana.com (select Devnet)");
          console.log("  Or: solana airdrop 2 --url devnet");
        }
      }
    }
  } else {
    console.log("Sufficient balance, skipping airdrop.");
  }

  const [poolPda] = PublicKey.findProgramAddressSync(
    [POOL_SEED, UST_MINT.toBuffer()],
    PROGRAM_ID
  );
  console.log("Pool PDA:", poolPda.toBase58());

  try {
    const poolAccount = await connection.getAccountInfo(poolPda);
    if (poolAccount) {
      console.log("Pool account exists. Data length:", poolAccount.data.length);
    } else {
      console.log("Pool account does not exist on devnet (not yet initialized).");
    }
  } catch (e) {
    console.log("Could not fetch pool:", (e as Error).message);
  }

  console.log("\nDone. You can now:");
  console.log("1. Run: cd app && npm run dev");
  console.log("2. Connect Phantom (switch to Devnet)");
  console.log("3. Import wallet or use same keypair for faucet SOL");
  console.log("4. Test Stake UST (requires pool + UST mint on devnet)");
  console.log("5. Test Stake with SOL (requires NEXT_PUBLIC_RAYDIUM_SOL_UST_POOL_ID)");
}

main().catch(console.error);
