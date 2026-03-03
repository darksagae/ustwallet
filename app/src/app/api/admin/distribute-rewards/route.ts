import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeAccruedReward, REFERRAL_LEVELS } from "@/lib/constants";

async function getReferrerChain(wallet: string): Promise<string[]> {
  const chain: string[] = [];
  let current = wallet;
  for (let i = 0; i < REFERRAL_LEVELS.length; i++) {
    const ref = await prisma.referral.findUnique({
      where: { referred: current },
    });
    if (!ref) break;
    chain.push(ref.referrer);
    current = ref.referrer;
  }
  return chain;
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = Math.floor(Date.now() / 1000);

  const activeStakes = await prisma.stake.findMany({
    where: { status: "active" },
  });

  if (activeStakes.length === 0) {
    return NextResponse.json({ distributed: 0, message: "No active stakes" });
  }

  let distributed = 0;
  let referralBonuses = 0;
  const errors: string[] = [];

  for (const stake of activeStakes) {
    try {
      const totalAccrued = computeAccruedReward(
        Number(stake.amount),
        stake.tierBps,
        stake.startTime,
        now
      );

      const alreadyDistributed = Number(stake.rewardDistributed);
      const newReward = Math.floor(totalAccrued) - alreadyDistributed;

      if (newReward <= 0) continue;

      // Update accrued for UI/emails only; no UST move to child until unlock
      await prisma.stake.update({
        where: { id: stake.id },
        data: {
          rewardDistributed: BigInt(Math.floor(totalAccrued)),
        },
      });

      const chain = await getReferrerChain(stake.wallet);
      for (let i = 0; i < chain.length; i++) {
        const levelConfig = REFERRAL_LEVELS[i];
        const bonus = Math.floor((newReward * levelConfig.bps) / 10_000);
        if (bonus <= 0) continue;

        await prisma.referralBalance.upsert({
          where: { wallet: chain[i] },
          create: {
            wallet: chain[i],
            balance: BigInt(bonus),
            totalEarned: BigInt(bonus),
          },
          update: {
            balance: { increment: BigInt(bonus) },
            totalEarned: { increment: BigInt(bonus) },
          },
        });

        await prisma.referralAccrual.create({
          data: {
            wallet: chain[i],
            amount: BigInt(bonus),
            level: levelConfig.level,
            sourceStakeId: stake.id,
            sourceWallet: stake.wallet,
          },
        });

        referralBonuses++;
      }
    } catch (e: unknown) {
      const msg = `${stake.wallet}: ${(e as Error).message}`;
      errors.push(msg);
      console.error("distribute-rewards error:", msg);
    }
  }

  return NextResponse.json({
    distributed,
    referralBonuses,
    total: activeStakes.length,
    errors: errors.length > 0 ? errors : undefined,
  });
}
