import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { prisma } from "@/lib/prisma";
import {
  UST_MINT,
  RPC_URL,
  LOCK_DAYS,
  DAILY_BPS,
  FLAT_RATE_LABEL,
  MIN_STAKE_USD,
  MIN_STAKE_UST_FALLBACK,
  computeReward,
} from "@/lib/constants";
import { getUstPriceUsd } from "@/lib/price";
import {
  createChildWallet,
  transferToChild,
  getMainWalletPublicKey,
} from "@/lib/custody";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { wallet, txSignature, amount, referrer } = body as {
      wallet?: string;
      txSignature?: string;
      amount?: number;
      referrer?: string;
    };

    if (!wallet || !txSignature || !amount || amount <= 0) {
      return NextResponse.json(
        { error: "wallet, txSignature, and amount are required" },
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

    const activeStake = await prisma.stake.findFirst({
      where: { wallet, status: "active" },
    });
    if (activeStake) {
      return NextResponse.json(
        { error: "You already have an active stake. Wait for unlock." },
        { status: 409 }
      );
    }

    const connection = new Connection(RPC_URL, "confirmed");
    const txInfo = await connection.getTransaction(txSignature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    if (!txInfo || txInfo.meta?.err) {
      return NextResponse.json(
        { error: "Transaction not found or failed on-chain" },
        { status: 400 }
      );
    }

    const mainWallet = getMainWalletPublicKey();
    const mainAta = getAssociatedTokenAddressSync(UST_MINT, mainWallet);
    const userPubkey = new PublicKey(wallet);
    const userAta = getAssociatedTokenAddressSync(UST_MINT, userPubkey);

    const preBalances = txInfo.meta?.preTokenBalances || [];
    const postBalances = txInfo.meta?.postTokenBalances || [];

    const mainAtaStr = mainAta.toBase58();
    const userAtaStr = userAta.toBase58();

    const accountKeys =
      txInfo.transaction.message.getAccountKeys?.() ??
      (txInfo.transaction.message as { staticAccountKeys?: PublicKey[] })
        .staticAccountKeys;

    let mainAtaIdx = -1;
    let userAtaIdx = -1;
    if (accountKeys) {
      const keys = Array.isArray(accountKeys)
        ? accountKeys
        : accountKeys.staticAccountKeys || [];
      for (let i = 0; i < keys.length; i++) {
        const k = typeof keys[i] === "string" ? keys[i] : keys[i]?.toBase58?.();
        if (k === mainAtaStr) mainAtaIdx = i;
        if (k === userAtaStr) userAtaIdx = i;
      }
    }

    let depositVerified = false;
    if (mainAtaIdx >= 0 && userAtaIdx >= 0) {
      const mainPre =
        preBalances.find((b) => b.accountIndex === mainAtaIdx)?.uiTokenAmount
          ?.amount || "0";
      const mainPost =
        postBalances.find((b) => b.accountIndex === mainAtaIdx)?.uiTokenAmount
          ?.amount || "0";
      const received = BigInt(mainPost) - BigInt(mainPre);
      if (received >= BigInt(amount)) {
        depositVerified = true;
      }
    }

    if (!depositVerified) {
      return NextResponse.json(
        { error: "Could not verify UST deposit to main wallet" },
        { status: 400 }
      );
    }

    const ustPrice = await getUstPriceUsd();
    const minUst =
      ustPrice > 0
        ? Math.max(1, Math.ceil(MIN_STAKE_USD / ustPrice))
        : MIN_STAKE_UST_FALLBACK;
    if (amount < minUst) {
      return NextResponse.json(
        {
          error: `Minimum stake is $${MIN_STAKE_USD} USD equivalent (currently ~${minUst.toLocaleString()} UST)`,
        },
        { status: 400 }
      );
    }

    const totalReward = computeReward(amount, DAILY_BPS);
    const nowUnix = Math.floor(Date.now() / 1000);
    const unlockTime = nowUnix + LOCK_DAYS * 86400;

    const stake = await prisma.stake.create({
      data: {
        wallet,
        amount: BigInt(amount),
        tierBps: DAILY_BPS,
        tierLabel: FLAT_RATE_LABEL,
        startTime: nowUnix,
        unlockTime,
        totalReward: BigInt(Math.floor(totalReward)),
        depositTxSig: txSignature,
      },
    });

    await prisma.poolStats.upsert({
      where: { id: "singleton" },
      create: {
        totalStaked: BigInt(amount),
        rewardPoolReserved: BigInt(Math.floor(totalReward)),
      },
      update: {
        totalStaked: { increment: BigInt(amount) },
        rewardPoolReserved: { increment: BigInt(Math.floor(totalReward)) },
      },
    });

    let childPubkey: string | null = null;
    try {
      const child = await createChildWallet(stake.id);
      childPubkey = child.publicKey.toBase58();
      await transferToChild(child.publicKey, BigInt(amount));
    } catch (e) {
      console.error("Child wallet creation/transfer failed:", e);
    }

    if (referrer && referrer !== wallet) {
      try {
        new PublicKey(referrer);
        const existing = await prisma.referral.findUnique({
          where: { referred: wallet },
        });
        if (!existing) {
          await prisma.referral.create({
            data: { referrer, referred: wallet },
          });
        }
      } catch {
        // invalid referrer pubkey or duplicate — skip silently
      }
    }

    return NextResponse.json({
      stakeId: stake.id,
      wallet: stake.wallet,
      amount: stake.amount.toString(),
      tierLabel: stake.tierLabel,
      tierBps: stake.tierBps,
      startTime: stake.startTime,
      unlockTime: stake.unlockTime,
      totalReward: stake.totalReward.toString(),
      childWallet: childPubkey,
      status: stake.status,
    });
  } catch (e: unknown) {
    console.error("Stake API error:", e);
    return NextResponse.json(
      { error: (e as Error).message || "Internal server error" },
      { status: 500 }
    );
  }
}
