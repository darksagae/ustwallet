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

  const stakes = await prisma.stake.findMany({
    where: { wallet, status: { in: ["active", "unlocked"] } },
    include: { childWallet: { select: { publicKey: true } } },
    orderBy: { createdAt: "desc" },
  });

  if (!stakes.length) {
    return NextResponse.json({ stakes: [], pool: null });
  }

  const now = Math.floor(Date.now() / 1000);

  const stakesWithAccrued = stakes.map((stake) => {
    const accrued = computeAccruedReward(
      Number(stake.amount),
      stake.tierBps,
      stake.startTime,
      now
    );
    return {
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
    };
  });

  const pool = await prisma.poolStats.findUnique({
    where: { id: "singleton" },
  });

  return NextResponse.json({
    stakes: stakesWithAccrued,
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
