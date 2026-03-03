import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendRewardNotification, sendCreatorLowFundAlert } from "@/lib/email";
import { getUstPriceUsd } from "@/lib/price";
import { DAILY_PCT, FLAT_RATE_LABEL, computeAccruedReward, LOCK_DAYS } from "@/lib/constants";
import { randomBytes } from "crypto";

function generateUnsubscribeToken(): string {
  return randomBytes(32).toString("hex");
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

function getTierLabel(_bps: number): { label: string; dailyPct: string } {
  return { label: FLAT_RATE_LABEL, dailyPct: DAILY_PCT.toString() };
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = Math.floor(Date.now() / 1000);
  const hourBucket = new Date();
  hourBucket.setMinutes(0, 0, 0);
  const dayBucket = new Date();
  dayBucket.setHours(0, 0, 0, 0);

  const creatorEmail = process.env.CREATOR_EMAIL;
  if (creatorEmail) {
    try {
      const pool = await prisma.poolStats.findUnique({
        where: { id: "singleton" },
      });
      if (pool) {
        const rewardPoolMax = Number(pool.rewardPoolMax);
        const rewardPoolReserved = Number(pool.rewardPoolReserved);
        if (rewardPoolMax > 0) {
          const usagePct = (rewardPoolReserved / rewardPoolMax) * 100;
          if (usagePct >= 90) {
            const existing = await prisma.creatorAlert.findFirst({
              where: { threshold: 90 },
              orderBy: { triggeredAt: "desc" },
            });
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            if (!existing?.triggeredAt || existing.triggeredAt < oneDayAgo) {
              await sendCreatorLowFundAlert({
                to: creatorEmail,
                usagePct,
                rewardPoolMax: rewardPoolMax.toLocaleString(),
                rewardPoolReserved: rewardPoolReserved.toLocaleString(),
              });
              await prisma.creatorAlert.create({ data: { threshold: 90 } });
            }
          }
        }
      }
    } catch (e) {
      console.error("Creator alert error:", e);
    }
  }

  const subscribers = await prisma.userNotification.findMany({
    where: { subscribed: true },
  });

  if (subscribers.length === 0) {
    return NextResponse.json({ sent: 0, message: "No subscribers" });
  }

  const marketPrice = await getUstPriceUsd();

  let sent = 0;
  const errors: string[] = [];

  for (const sub of subscribers) {
    try {
      const stake = await prisma.stake.findFirst({
        where: { wallet: sub.wallet, status: "active" },
      });
      if (!stake) continue;

      const amountStaked = Number(stake.amount);
      const tierBps = stake.tierBps;
      const startTime = stake.startTime;
      const unlockTime = stake.unlockTime;

      const elapsedSeconds = now - startTime;
      const isFirst24h = elapsedSeconds < 24 * 3600;
      const bucket = isFirst24h ? hourBucket : dayBucket;

      const existing = await prisma.notificationLog.findUnique({
        where: { wallet_hourBucket: { wallet: sub.wallet, hourBucket: bucket } },
      });
      if (existing) continue;

      const accrued = computeAccruedReward(amountStaked, tierBps, startTime, now);
      const daysRemaining = Math.max(0, Math.ceil((unlockTime - now) / 86400));
      const totalLockSeconds = LOCK_DAYS * 86400;
      const unlockProgressPct = Math.min(
        100,
        (elapsedSeconds / totalLockSeconds) * 100
      );
      const { label, dailyPct } = getTierLabel(tierBps);
      const accruedNum = parseFloat(accrued.toFixed(4));
      const estimatedUsd =
        marketPrice > 0 ? `$${(accruedNum * marketPrice).toFixed(2)}` : "—";

      let token = sub.unsubscribeToken;
      if (!token) {
        token = generateUnsubscribeToken();
        await prisma.userNotification.update({
          where: { wallet: sub.wallet },
          data: { unsubscribeToken: token },
        });
      }
      const unsubscribeUrl = `${APP_URL}/api/unsubscribe?token=${token}`;

      const providerId = await sendRewardNotification({
        to: sub.email,
        wallet: sub.wallet,
        principal: amountStaked.toLocaleString(),
        accruedReward: accrued.toFixed(4),
        tierLabel: label,
        dailyPct,
        unlockDate: new Date(unlockTime * 1000).toLocaleDateString(),
        daysRemaining,
        unlockProgressPct,
        marketPriceUsd: marketPrice,
        estimatedUsdValue: estimatedUsd,
        unsubscribeUrl,
        restakeCta: daysRemaining <= 7,
      });

      await prisma.notificationLog.create({
        data: {
          wallet: sub.wallet,
          hourBucket: bucket,
          accruedReward: accrued.toFixed(4),
          principal: amountStaked.toString(),
          tierBps,
          status: "sent",
          providerId: providerId || null,
        },
      });

      await prisma.userNotification.update({
        where: { wallet: sub.wallet },
        data: {
          lastSentAt: new Date(),
          firstStakeSeenAt: sub.firstStakeSeenAt ?? new Date(),
        },
      });

      sent++;
    } catch (e: unknown) {
      errors.push(`${sub.wallet}: ${(e as Error).message}`);
    }
  }

  return NextResponse.json({
    sent,
    total: subscribers.length,
    errors: errors.length > 0 ? errors : undefined,
  });
}
