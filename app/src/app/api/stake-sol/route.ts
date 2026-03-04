import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { prisma } from "@/lib/prisma";
import {
  UST_MINT,
  RPC_URL,
  RPC_FALLBACK_URL,
  LOCK_DAYS,
  DAILY_BPS,
  FLAT_RATE_LABEL,
  MIN_STAKE_USD,
  MIN_STAKE_UST_FALLBACK,
  computeReward,
} from "@/lib/constants";
import { getSolPriceUsd, getUstPriceUsd } from "@/lib/price";
import { getMainWalletPublicKey, getConnection } from "@/lib/custody";
import { swapSolToUst } from "@/lib/raydiumSwap";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { wallet, txSignature, referrer } = body as {
      wallet?: string;
      txSignature?: string;
      referrer?: string;
    };
    console.log("[Stake-SOL API] Received", { wallet: wallet?.slice(0, 8) + "...", sig: txSignature?.slice(0, 16) + "...", referrer: referrer ?? "none" });

    if (!wallet || !txSignature) {
      return NextResponse.json(
        { error: "wallet and txSignature are required" },
        { status: 400 }
      );
    }

    const existing = await prisma.stake.findUnique({
      where: { depositTxSig: txSignature },
    });
    if (existing) {
      return NextResponse.json(
        { error: "This transaction has already been recorded" },
        { status: 409 }
      );
    }

    let connection = new Connection(RPC_URL, "confirmed");
    let txInfo: Awaited<ReturnType<Connection["getTransaction"]>>;
    try {
      txInfo = await connection.getTransaction(txSignature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
    } catch (e: unknown) {
      const msg = (e as Error).message ?? "";
      if (
        (msg.includes("403") || msg.includes("Access forbidden")) &&
        RPC_FALLBACK_URL
      ) {
        connection = new Connection(RPC_FALLBACK_URL, "confirmed");
        txInfo = await connection.getTransaction(txSignature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });
      } else {
        throw e;
      }
    }

    if (!txInfo || txInfo.meta?.err) {
      console.log("[Stake-SOL API] Tx not found or failed on-chain:", txSignature?.slice(0, 16) + "...");
      return NextResponse.json(
        { error: "Transaction not found or failed on-chain" },
        { status: 400 }
      );
    }
    console.log("[Stake-SOL API] Tx found and valid");

    const mainWallet = getMainWalletPublicKey();
    const mainWalletStr = mainWallet.toBase58();
    const userPubkey = new PublicKey(wallet);

    const accountKeys =
      txInfo.transaction.message.getAccountKeys?.() ??
      (txInfo.transaction.message as { staticAccountKeys?: PublicKey[] })
        .staticAccountKeys;

    let mainIdx = -1;
    let userIdx = -1;
    if (accountKeys) {
      const keys = Array.isArray(accountKeys)
        ? accountKeys
        : accountKeys.staticAccountKeys || [];
      for (let i = 0; i < keys.length; i++) {
        const k =
          typeof keys[i] === "string" ? keys[i] : keys[i]?.toBase58?.();
        if (k === mainWalletStr) mainIdx = i;
        if (k === wallet) userIdx = i;
      }
    }

    if (mainIdx < 0 || userIdx < 0) {
      return NextResponse.json(
        { error: "Could not identify SOL transfer participants in tx" },
        { status: 400 }
      );
    }

    const preBalances = txInfo.meta?.preBalances || [];
    const postBalances = txInfo.meta?.postBalances || [];

    const mainReceived =
      BigInt(postBalances[mainIdx] ?? 0) - BigInt(preBalances[mainIdx] ?? 0);

    if (mainReceived <= BigInt(0)) {
      return NextResponse.json(
        { error: "Could not verify SOL deposit to custody wallet" },
        { status: 400 }
      );
    }

    const solLamports = mainReceived;

    const solAmount = Number(solLamports) / LAMPORTS_PER_SOL;
    const solPrice = await getSolPriceUsd();
    console.log("[Stake-SOL API] SOL received:", solAmount, "SOL, price:", solPrice, "USD, min:", MIN_STAKE_USD);
    if (solPrice > 0 && solAmount * solPrice < MIN_STAKE_USD) {
      return NextResponse.json(
        {
          error: `Minimum deposit is $${MIN_STAKE_USD} USD of SOL. You sent ~$${(solAmount * solPrice).toFixed(2)}.`,
        },
        { status: 400 }
      );
    }

    const ustAtaBefore = await (async () => {
      try {
        const ata = getAssociatedTokenAddressSync(UST_MINT, mainWallet);
        const conn = getConnection();
        const info = await conn.getTokenAccountBalance(ata);
        return BigInt(info.value.amount);
      } catch {
        return BigInt(0);
      }
    })();

    let swapTxId: string;
    try {
      console.log("[Stake-SOL API] Starting SOL→UST swap, lamports:", solLamports.toString());
      const result = await swapSolToUst(solLamports);
      swapTxId = result.txId;
      console.log("[Stake-SOL API] Swap done, txId:", swapTxId);
    } catch (e: unknown) {
      console.log("[Stake-SOL API] Swap failed:", (e as Error).message);
      return NextResponse.json(
        {
          error: `SOL→UST swap failed: ${(e as Error).message || "Unknown error"}. Your SOL deposit was received but swap could not complete.`,
        },
        { status: 500 }
      );
    }

    const ustAtaAfter = await (async () => {
      try {
        const ata = getAssociatedTokenAddressSync(UST_MINT, mainWallet);
        const conn = getConnection();
        const info = await conn.getTokenAccountBalance(ata);
        return BigInt(info.value.amount);
      } catch {
        return BigInt(0);
      }
    })();

    const ustReceived = ustAtaAfter - ustAtaBefore;
    if (ustReceived <= BigInt(0)) {
      return NextResponse.json(
        {
          error:
            "Swap executed but no UST was received. Contact support with your tx signature.",
        },
        { status: 500 }
      );
    }

    const ustDecimals = 6;
    const ustAmount = Number(ustReceived) / 10 ** ustDecimals;

    const ustPrice = await getUstPriceUsd();
    const minUst =
      ustPrice > 0
        ? Math.max(1, Math.ceil(MIN_STAKE_USD / ustPrice))
        : MIN_STAKE_UST_FALLBACK;
    if (ustAmount < minUst) {
      return NextResponse.json(
        {
          error: `Swapped SOL yielded ${ustAmount.toFixed(2)} UST which is below the minimum ($${MIN_STAKE_USD} USD ≈ ${minUst.toLocaleString()} UST)`,
        },
        { status: 400 }
      );
    }

    const totalReward = computeReward(ustAmount, DAILY_BPS);
    const nowUnix = Math.floor(Date.now() / 1000);
    const unlockTime = nowUnix + LOCK_DAYS * 86400;

    const stake = await prisma.stake.create({
      data: {
        wallet,
        amount: ustReceived,
        tierBps: DAILY_BPS,
        tierLabel: FLAT_RATE_LABEL,
        startTime: nowUnix,
        unlockTime,
        totalReward: BigInt(Math.floor(totalReward)),
        depositTxSig: txSignature,
      },
    });
    console.log("[Stake-SOL API] Stake created:", stake.id, "UST amount:", ustAmount.toFixed(2));

    await prisma.poolStats.upsert({
      where: { id: "singleton" },
      create: {
        totalStaked: ustReceived,
        rewardPoolReserved: BigInt(Math.floor(totalReward)),
      },
      update: {
        totalStaked: { increment: ustReceived },
        rewardPoolReserved: { increment: BigInt(Math.floor(totalReward)) },
      },
    });

    if (referrer && referrer !== wallet) {
      try {
        new PublicKey(referrer);
        const existingRef = await prisma.referral.findUnique({
          where: { referred: wallet },
        });
        if (!existingRef) {
          await prisma.referral.create({
            data: { referrer, referred: wallet },
          });
        }
      } catch {
        // invalid referrer — skip
      }
    }

    console.log("[Stake-SOL API] Success, returning response");
    return NextResponse.json({
      stakeId: stake.id,
      wallet: stake.wallet,
      amount: stake.amount.toString(),
      ustAmount: ustAmount.toFixed(2),
      tierLabel: stake.tierLabel,
      tierBps: stake.tierBps,
      startTime: stake.startTime,
      unlockTime: stake.unlockTime,
      totalReward: stake.totalReward.toString(),
      status: stake.status,
      swapTxId,
      solDeposited: (Number(solLamports) / LAMPORTS_PER_SOL).toFixed(4),
    });
  } catch (e: unknown) {
    console.error("[Stake-SOL API] Error:", e);
    return NextResponse.json(
      { error: (e as Error).message || "Internal server error" },
      { status: 500 }
    );
  }
}
