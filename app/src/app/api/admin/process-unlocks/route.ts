import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { prisma } from "@/lib/prisma";
import { transferToChild } from "@/lib/custody";

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = Math.floor(Date.now() / 1000);

  const readyStakes = await prisma.stake.findMany({
    where: {
      status: "active",
      unlockTime: { lte: now },
    },
    include: { childWallet: true },
  });

  if (readyStakes.length === 0) {
    return NextResponse.json({ processed: 0, message: "No stakes ready" });
  }

  let processed = 0;
  const errors: string[] = [];

  for (const stake of readyStakes) {
    try {
      if (!stake.childWallet) continue;

      const totalReward = BigInt(stake.totalReward.toString());
      const childPubkey = new PublicKey(stake.childWallet.publicKey);

      // Move rewards from custody to child so child holds principal + rewards; user chooses Withdraw or Restake later
      await transferToChild(childPubkey, totalReward);

      await prisma.stake.update({
        where: { id: stake.id },
        data: { status: "unlocked" },
      });

      processed++;
    } catch (e: unknown) {
      const msg = `${stake.wallet}: ${(e as Error).message}`;
      errors.push(msg);
      console.error("process-unlocks error:", msg);
    }
  }

  return NextResponse.json({
    processed,
    total: readyStakes.length,
    errors: errors.length > 0 ? errors : undefined,
  });
}
