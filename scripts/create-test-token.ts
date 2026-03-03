/**
 * Create a test UST token on devnet and mint to custody + your wallet.
 *
 * Usage:
 *   npx ts-node scripts/create-test-token.ts
 *   RECIPIENT=YourPhantomAddress npx ts-node scripts/create-test-token.ts
 *
 * Requires: default Solana keypair (~/.config/solana/id.json) with devnet SOL.
 */

import * as fs from "fs";
import * as path from "path";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createMint,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  createMintToInstruction,
  TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
const CUSTODY_PUBKEY = "EF5psr9kh8UJTBGfpkJs53gr3po3ofViXPNnt9Y84Voy";

function loadKeypair(p: string): Keypair {
  const resolved = p.startsWith("~")
    ? path.join(process.env.HOME || "", p.slice(1))
    : p;
  const j = JSON.parse(fs.readFileSync(resolved, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(j));
}

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const payer = loadKeypair(process.env.ANCHOR_WALLET || "~/.config/solana/id.json");
  const recipientStr = process.env.RECIPIENT || payer.publicKey.toBase58();

  console.log("Payer:", payer.publicKey.toBase58());
  console.log("Custody:", CUSTODY_PUBKEY);
  console.log("Recipient:", recipientStr);

  const custodyPubkey = new PublicKey(CUSTODY_PUBKEY);
  const recipientPubkey = new PublicKey(recipientStr);

  console.log("\n1. Creating mint (6 decimals, like UST)...");
  const mint = await createMint(
    connection,
    payer,
    payer.publicKey,
    null,
    6,
    undefined,
    undefined,
    TOKEN_PROGRAM_ID
  );
  console.log("   Mint:", mint.toBase58());

  console.log("\n2. Creating custody ATA and minting 1,000,000 test UST...");
  const custodyAta = getAssociatedTokenAddressSync(mint, custodyPubkey);
  const custodyAtaInfo = await connection.getAccountInfo(custodyAta);
  if (!custodyAtaInfo) {
    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        custodyAta,
        custodyPubkey,
        mint
      )
    );
    await sendAndConfirmTransaction(connection, tx, [payer]);
  }
  await mintTo(
    connection,
    payer,
    mint,
    custodyAta,
    payer.publicKey,
    1_000_000 * 1_000_000, // 1M tokens (6 decimals)
    [],
    undefined,
    TOKEN_PROGRAM_ID
  );
  console.log("   Custody has 1,000,000 test UST (for rewards).");

  console.log("\n3. Minting 10,000 test UST to recipient...");
  await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mint,
    recipientPubkey,
    true
  );
  await mintTo(
    connection,
    payer,
    mint,
    getAssociatedTokenAddressSync(mint, recipientPubkey),
    payer.publicKey,
    10_000 * 1_000_000, // 10k tokens (6 decimals)
    [],
    undefined,
    TOKEN_PROGRAM_ID
  );
  console.log("   Recipient has 10,000 test UST (for staking).");

  console.log("\n--- DONE ---");
  console.log("Test token mint:", mint.toBase58());
  console.log("\nUpdate app/.env.local:");
  console.log("NEXT_PUBLIC_UST_MINT=" + mint.toBase58());
  console.log("\nThen restart the app and stake from the recipient wallet.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
