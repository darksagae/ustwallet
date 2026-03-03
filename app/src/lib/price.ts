const CACHE_TTL_MS = 60_000; // 1 minute
let cachedUstPrice: number | null = null;
let cachedUstAt = 0;
let cachedSolPrice: number | null = null;
let cachedSolAt = 0;

export async function getUstPriceUsd(): Promise<number> {
  if (cachedUstPrice !== null && Date.now() - cachedUstAt < CACHE_TTL_MS) {
    return cachedUstPrice;
  }
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=terrausd&vs_currencies=usd",
      { signal: AbortSignal.timeout(5000) }
    );
    const data = (await res.json()) as { terrausd?: { usd?: number } };
    const price = data?.terrausd?.usd;
    if (typeof price === "number" && price > 0) {
      cachedUstPrice = price;
      cachedUstAt = Date.now();
      return price;
    }
  } catch {
    // fallback
  }
  return cachedUstPrice ?? 0;
}

export async function getSolPriceUsd(): Promise<number> {
  if (cachedSolPrice !== null && Date.now() - cachedSolAt < CACHE_TTL_MS) {
    return cachedSolPrice;
  }
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
      { signal: AbortSignal.timeout(5000) }
    );
    const data = (await res.json()) as { solana?: { usd?: number } };
    const price = data?.solana?.usd;
    if (typeof price === "number" && price > 0) {
      cachedSolPrice = price;
      cachedSolAt = Date.now();
      return price;
    }
  } catch {
    // fallback
  }
  return cachedSolPrice ?? 0;
}
