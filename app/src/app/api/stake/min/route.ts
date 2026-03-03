import { NextResponse } from "next/server";
import { getUstPriceUsd } from "@/lib/price";
import { MIN_STAKE_USD, MIN_STAKE_UST_FALLBACK } from "@/lib/constants";

export async function GET() {
  const ustPrice = await getUstPriceUsd();
  const minUst =
    ustPrice > 0
      ? Math.max(1, Math.ceil(MIN_STAKE_USD / ustPrice))
      : MIN_STAKE_UST_FALLBACK;
  // #region agent log
  fetch("http://127.0.0.1:7461/ingest/6be44dbf-6d75-468a-9657-edaa08940de1", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "e39c62" },
    body: JSON.stringify({
      sessionId: "e39c62",
      location: "api/stake/min/route.ts",
      message: "Server MIN_STAKE values",
      data: { MIN_STAKE_USD, MIN_STAKE_UST_FALLBACK, minUst, minUsd: MIN_STAKE_USD },
      timestamp: Date.now(),
      hypothesisId: "H2",
    }),
  }).catch(() => {});
  // #endregion
  return NextResponse.json({ minUst, minUsd: MIN_STAKE_USD });
}
