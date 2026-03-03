import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { prisma } from "@/lib/prisma";
import {
  LOCK_DAYS,
  RESTAKE_DAILY_BPS,
  RESTAKE_LABEL,
  computeReward,
} from "@/lib/constants";
import {
  createChildWallet,
  transferFromChildToAddress,
  getChildTokenBalance,
} from "@/lib/custody";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { stakeId, wallet } = body as { stakeId?: string; wallet?: string };

    if (!stakeId || !wallet) {
      return NextResponse.json(
        { error: "stakeId and wallet are required" },
        { status: 400 }
      );
    }

    const stake = await prisma.stake.findUnique({
      where: { id: stakeId },
      include: { childWallet: true },
    });

    if (!stake) {
      return NextResponse.json({ error: "Stake not found" }, { status: 404 });
    }

    if (stake.wallet !== wallet) {
      return NextResponse.json(
        { error: "Not authorized to restake this stake" },
        { status: 403 }
      );
    }

    if (stake.status !== "unlocked") {
      return NextResponse.json(
        {
          error:
            "Stake is not unlocked. Only unlocked stakes can be restaked.",
        },
        { status: 400 }
      );
    }

    if (!stake.childWallet) {
      return NextResponse.json(
        { error: "Stake has no child wallet" },
        { status: 400 }
      );
    }

    const childPubkey = new PublicKey(stake.childWallet.publicKey);
    const amountBigInt = await getChildTokenBalance(childPubkey);
    if (amountBigInt <= BigInt(0)) {
      return NextResponse.json(
        { error: "Child wallet has no balance to restake" },
        { status: 400 }
      );
    }

    const amount = Number(amountBigInt);
    const totalReward = computeReward(amount, RESTAKE_DAILY_BPS);
    const nowUnix = Math.floor(Date.now() / 1000);
    const unlockTime = nowUnix + LOCK_DAYS * 86400;
    const depositTxSig = `restake-${stakeId}`;

    const newStake = await prisma.stake.create({
      data: {
        wallet: stake.wallet,
        amount: amountBigInt,
        tierBps: RESTAKE_DAILY_BPS,
        tierLabel: RESTAKE_LABEL,
        startTime: nowUnix,
        unlockTime,
        totalReward: BigInt(Math.floor(totalReward)),
        depositTxSig,
      },
    });

    await prisma.poolStats.upsert({
      where: { id: "singleton" },
      create: {
        totalStaked: amountBigInt,
        rewardPoolReserved: BigInt(Math.floor(totalReward)),
      },
      update: {
        totalStaked: { increment: amountBigInt },
        rewardPoolReserved: {
          increment: BigInt(Math.floor(totalReward)),
        },
      },
    });

    const child = await createChildWallet(newStake.id);
    await transferFromChildToAddress(
      stake.childWallet.encryptedSecretKey,
      stake.childWallet.iv,
      stake.childWallet.authTag,
      child.publicKey,
      amountBigInt
    );

    await prisma.stake.update({
      where: { id: stakeId },
      data: { status: "claimed" },
    });

    return NextResponse.json({
      newStakeId: newStake.id,
      amount: newStake.amount.toString(),
      unlockTime: newStake.unlockTime,
      tierLabel: RESTAKE_LABEL,
    });
  } catch (e: unknown) {
    console.error("[stake/restake] Error:", e);
    return NextResponse.json(
      { error: (e as Error).message || "Internal server error" },
      { status: 500 }
    );
  }
}
