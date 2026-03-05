#!/usr/bin/env node
/**
 * Count SPL token accounts for a wallet. Usage:
 *   node scripts/count-tokens.mjs [WALLET_PUBKEY]
 * If WALLET_PUBKEY is omitted, uses NEXT_PUBLIC_MAIN_WALLET from .env.local
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env.local");
if (existsSync(envPath)) {
  const content = readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const m = line.match(/^\s*([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const defaultWallet = process.env.NEXT_PUBLIC_MAIN_WALLET;
const walletPubkey = process.argv[2] || defaultWallet;
if (!walletPubkey) {
  console.error("Usage: node count-tokens.mjs [WALLET_PUBKEY] or set NEXT_PUBLIC_MAIN_WALLET in .env.local");
  process.exit(1);
}

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const conn = new Connection(RPC);
const owner = new PublicKey(walletPubkey);
const accounts = await conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID });
const list = accounts.value;
const withBalance = list.filter((a) => a.account.data.parsed.info.tokenAmount.uiAmount > 0);
console.log("Wallet:", walletPubkey);
console.log("Total token accounts:", list.length);
console.log("With balance > 0:", withBalance.length);
if (withBalance.length > 0) {
  console.log("\nTokens with balance:");
  for (const a of withBalance) {
    const info = a.account.data.parsed.info;
    const sym = info.tokenAmount.symbol || info.mint?.slice(0, 8) + "…";
    console.log("  -", sym, ":", info.tokenAmount.uiAmountString, "(mint:", info.mint + ")");
  }
}
