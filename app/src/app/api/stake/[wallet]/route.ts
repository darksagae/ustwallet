import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeAccruedReward } from "@/lib/constants";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ wallet: string }> }
) {
  const { wallet } = await params;

  if (!wallet) {
    return NextResponse.json({ error: "wallet is required" }, { status: 400 });
  }

  const stake = await prisma.stake.findFirst({
    where: { wallet, status: { in: ["active", "unlocked"] } },
    include: { childWallet: { select: { publicKey: true } } },
    orderBy: { createdAt: "desc" },
  });

  if (!stake) {
    return NextResponse.json({ stake: null });
  }

  const now = Math.floor(Date.now() / 1000);
  const accrued = computeAccruedReward(
    Number(stake.amount),
    stake.tierBps,
    stake.startTime,
    now
  );

  const pool = await prisma.poolStats.findUnique({
    where: { id: "singleton" },
  });

  return NextResponse.json({
    stake: {
      id: stake.id,
      wallet: stake.wallet,
      amount: stake.amount.toString(),
      tierBps: stake.tierBps,
      tierLabel: stake.tierLabel,
      startTime: stake.startTime,
      unlockTime: stake.unlockTime,
      totalReward: stake.totalReward.toString(),
      rewardDistributed: stake.rewardDistributed.toString(),
      accrued: Math.floor(accrued),
      status: stake.status,
      childWallet: stake.childWallet?.publicKey || null,
      depositTxSig: stake.depositTxSig,
      claimTxSig: stake.claimTxSig,
    },
    pool: pool
      ? {
          totalStaked: pool.totalStaked.toString(),
          capTotalStaked: pool.capTotalStaked.toString(),
          rewardPoolMax: pool.rewardPoolMax.toString(),
          rewardPoolReserved: pool.rewardPoolReserved.toString(),
        }
      : null,
  });
}
