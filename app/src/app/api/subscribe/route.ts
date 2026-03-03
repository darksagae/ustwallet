import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "crypto";

const prisma = new PrismaClient();

function generateUnsubscribeToken(): string {
  return randomBytes(32).toString("hex");
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const wallet = body.wallet as string;
    const email = body.email as string;

    if (!wallet || typeof wallet !== "string") {
      return NextResponse.json({ error: "wallet is required" }, { status: 400 });
    }
    if (!email || typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json(
        { error: "Valid email is required" },
        { status: 400 }
      );
    }

    const existing = await prisma.userNotification.findUnique({
      where: { wallet },
    });
    const token = existing?.unsubscribeToken ?? generateUnsubscribeToken();

    await prisma.userNotification.upsert({
      where: { wallet },
      create: { wallet, email, subscribed: true, unsubscribeToken: token },
      update: { email, subscribed: true, unsubscribeToken: token },
    });

    return NextResponse.json({ message: "Subscribed to reward notifications!" });
  } catch (e: unknown) {
    console.error("Subscribe error:", e);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
