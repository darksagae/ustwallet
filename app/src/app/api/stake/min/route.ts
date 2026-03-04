import { NextResponse } from "next/server";
import { getUstPriceUsd, getSolPriceUsd } from "@/lib/price";
import { MIN_STAKE_USD, MIN_STAKE_UST_FALLBACK } from "@/lib/constants";

export async function GET() {
  const ustPrice = await getUstPriceUsd();
  const solPrice = await getSolPriceUsd();

  const minUst =
    ustPrice > 0
      ? Math.max(1, Math.ceil(MIN_STAKE_USD / ustPrice))
      : MIN_STAKE_UST_FALLBACK;

  const minSol =
    solPrice > 0
      ? Math.ceil((MIN_STAKE_USD / solPrice) * 1000) / 1000
      : 0;

  return NextResponse.json({
    minUst,
    minUsd: MIN_STAKE_USD,
    minSol,
    solPriceUsd: solPrice,
  });
}
