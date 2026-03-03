import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function baseUrl(req: NextRequest): string {
  return process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin || "http://localhost:3000";
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const base = baseUrl(req);
  if (!token) {
    return NextResponse.redirect(new URL("/unsubscribe?error=missing", base));
  }
  try {
    const updated = await prisma.userNotification.updateMany({
      where: { unsubscribeToken: token, subscribed: true },
      data: { subscribed: false },
    });
    if (updated.count === 0) {
      return NextResponse.redirect(new URL("/unsubscribe?error=invalid", base));
    }
    return NextResponse.redirect(new URL("/unsubscribe?success=1", base));
  } catch {
    return NextResponse.redirect(new URL("/unsubscribe?error=server", base));
  }
}
