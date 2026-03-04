import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { requestId, txSignature } = body as {
      requestId?: string;
      txSignature?: string;
    };

    if (!requestId) {
      return NextResponse.json(
        { error: "requestId is required" },
        { status: 400 }
      );
    }

    const request = await prisma.stakeWithdrawalRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      return NextResponse.json(
        { error: "Withdrawal request not found" },
        { status: 404 }
      );
    }

    if (request.status !== "pending") {
      return NextResponse.json(
        { error: `Request is not pending (status: ${request.status})` },
        { status: 400 }
      );
    }

    await prisma.$transaction([
      prisma.stakeWithdrawalRequest.update({
        where: { id: requestId },
        data: {
          status: "approved",
          txSignature: txSignature ?? request.txSignature,
        },
      }),
      prisma.stake.update({
        where: { id: request.stakeId },
        data: { status: "claimed", claimTxSig: txSignature },
      }),
    ]);

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    console.error("[admin/withdrawal/approve] Error:", e);
    return NextResponse.json(
      { error: (e as Error).message || "Internal server error" },
      { status: 500 }
    );
  }
}
