import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { prisma } from "@/lib/prisma";
import { sendWithdrawalRequestedEmail } from "@/lib/email";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { stakeId, wallet, destinationWallet } = body as {
      stakeId?: string;
      wallet?: string;
      destinationWallet?: string;
    };

    if (!stakeId || !wallet) {
      return NextResponse.json(
        { error: "stakeId and wallet are required" },
        { status: 400 }
      );
    }

    const stake = await prisma.stake.findUnique({
      where: { id: stakeId },
    });

    if (!stake) {
      return NextResponse.json({ error: "Stake not found" }, { status: 404 });
    }

    if (stake.wallet !== wallet) {
      return NextResponse.json(
        { error: "Not authorized to withdraw this stake" },
        { status: 403 }
      );
    }

    if (stake.status !== "unlocked") {
      return NextResponse.json(
        { error: "Stake is not unlocked. Only unlocked stakes can be withdrawn." },
        { status: 400 }
      );
    }

    const totalPayout =
      BigInt(stake.amount.toString()) + BigInt(stake.totalReward.toString());
    const destination = destinationWallet ?? stake.wallet;

    let destinationPubkey: PublicKey;
    try {
      destinationPubkey = new PublicKey(destination);
    } catch {
      return NextResponse.json(
        { error: "Invalid destination wallet address" },
        { status: 400 }
      );
    }

    // Prevent duplicate pending withdrawals for this stake
    const existingRequest = await prisma.stakeWithdrawalRequest.findUnique({
      where: { stakeId },
    });
    if (existingRequest && existingRequest.status === "pending") {
      return NextResponse.json(
        {
          error:
            "You already have a pending withdrawal request for this stake. Please wait for confirmation.",
        },
        { status: 400 }
      );
    }

    const request = await prisma.stakeWithdrawalRequest.upsert({
      where: { stakeId },
      create: {
        stakeId,
        wallet,
        destination,
        amount: totalPayout,
        status: "pending",
      },
      update: {
        wallet,
        destination,
        amount: totalPayout,
        status: "pending",
      },
    });

    // Optionally mark stake as withdraw_pending to avoid duplicate UX actions
    await prisma.stake.update({
      where: { id: stakeId },
      data: { status: "withdraw_pending" },
    });

    // Notify creator/admin if email configured
    const creatorEmail = process.env.CREATOR_EMAIL;
    if (creatorEmail) {
      await sendWithdrawalRequestedEmail({
        to: creatorEmail,
        wallet,
        destination,
        amountTokens: (Number(totalPayout) / 1_000_000).toFixed(6),
        stakeId,
      });
    }

    return NextResponse.json({
      status: "pending",
      requestId: request.id,
      amount: totalPayout.toString(),
      message: "Withdrawal requested. Waiting for confirmation.",
    });
  } catch (e: unknown) {
    console.error("[stake/withdraw] Error:", e);
    return NextResponse.json(
      { error: (e as Error).message || "Internal server error" },
      { status: 500 }
    );
  }
}
