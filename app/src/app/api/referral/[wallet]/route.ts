import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ wallet: string }> }
) {
  const { wallet } = await params;

  if (!wallet) {
    return NextResponse.json({ error: "wallet is required" }, { status: 400 });
  }

  const balance = await prisma.referralBalance.findUnique({
    where: { wallet },
  });

  const referrals = await prisma.referral.findMany({
    where: { referrer: wallet },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const recentAccruals = await prisma.referralAccrual.findMany({
    where: { wallet },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return NextResponse.json({
    balance: balance?.balance.toString() ?? "0",
    totalEarned: balance?.totalEarned.toString() ?? "0",
    referralCode: wallet,
    referrals: referrals.map((r) => ({
      wallet: r.referred,
      joinedAt: r.createdAt.toISOString(),
    })),
    recentAccruals: recentAccruals.map((a) => ({
      amount: a.amount.toString(),
      level: a.level,
      sourceWallet: a.sourceWallet,
      createdAt: a.createdAt.toISOString(),
    })),
  });
}
