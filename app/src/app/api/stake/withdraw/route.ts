import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { prisma } from "@/lib/prisma";
import { transferFromChildToAddress } from "@/lib/custody";

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
      include: { childWallet: true },
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

    if (!stake.childWallet) {
      return NextResponse.json(
        { error: "Stake has no child wallet" },
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

    const claimTxSig = await transferFromChildToAddress(
      stake.childWallet.encryptedSecretKey,
      stake.childWallet.iv,
      stake.childWallet.authTag,
      destinationPubkey,
      totalPayout
    );

    await prisma.stake.update({
      where: { id: stakeId },
      data: { status: "claimed", claimTxSig },
    });

    return NextResponse.json({
      txSignature: claimTxSig,
      amount: stake.amount.toString(),
      totalReward: stake.totalReward.toString(),
    });
  } catch (e: unknown) {
    console.error("[stake/withdraw] Error:", e);
    return NextResponse.json(
      { error: (e as Error).message || "Internal server error" },
      { status: 500 }
    );
  }
}
