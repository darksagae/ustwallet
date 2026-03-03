import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { prisma } from "@/lib/prisma";
import { REFERRAL_MIN_CLAIM_USD } from "@/lib/constants";
import { transferFromMainToUser } from "@/lib/custody";
import { getUstPriceUsd } from "@/lib/price";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { wallet } = body as { wallet?: string };

    if (!wallet) {
      return NextResponse.json(
        { error: "wallet is required" },
        { status: 400 }
      );
    }

    let userPubkey: PublicKey;
    try {
      userPubkey = new PublicKey(wallet);
    } catch {
      return NextResponse.json(
        { error: "Invalid wallet address" },
        { status: 400 }
      );
    }

    const balance = await prisma.referralBalance.findUnique({
      where: { wallet },
    });

    if (!balance || balance.balance <= BigInt(0)) {
      return NextResponse.json(
        { error: "No referral balance to claim" },
        { status: 400 }
      );
    }

    const ustPrice = await getUstPriceUsd();
    const priceToUse = ustPrice > 0 ? ustPrice : 1;
    const balanceTokens = Number(balance.balance) / 1_000_000;
    const balanceUsd = balanceTokens * priceToUse;

    if (balanceUsd < REFERRAL_MIN_CLAIM_USD) {
      return NextResponse.json(
        {
          error: `Minimum claim is $${REFERRAL_MIN_CLAIM_USD} USD. Current balance: $${balanceUsd.toFixed(2)}`,
        },
        { status: 400 }
      );
    }

    const claimAmount = balance.balance;

    const txSig = await transferFromMainToUser(userPubkey, claimAmount);

    await prisma.referralBalance.update({
      where: { wallet },
      data: { balance: BigInt(0) },
    });

    return NextResponse.json({
      claimed: claimAmount.toString(),
      claimedUsd: balanceUsd.toFixed(2),
      txSignature: txSig,
    });
  } catch (e: unknown) {
    console.error("Referral claim error:", e);
    return NextResponse.json(
      { error: (e as Error).message || "Internal server error" },
      { status: 500 }
    );
  }
}
