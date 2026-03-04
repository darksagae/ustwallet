import { PublicKey } from "@solana/web3.js";

export const UST_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_UST_MINT || "11111111111111111111111111111111"
);

export const RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";

/** Optional fallback RPC when primary returns 403. Set NEXT_PUBLIC_SOLANA_RPC_FALLBACK (e.g. Helius). */
export const RPC_FALLBACK_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_FALLBACK || "";

export const LOCK_DAYS = 90;
export const DAILY_BPS = 100; // 1% daily
export const DAILY_PCT = 1;
/** Minimum stake in USD. Use NEXT_PUBLIC_ for client (browser); MIN_ for server. Testing: set both to 1; prod: 50. */
export const MIN_STAKE_USD = Number(
  process.env.NEXT_PUBLIC_MIN_STAKE_USD ?? process.env.MIN_STAKE_USD ?? "50"
);
/** Fallback min UST when price unavailable. Use NEXT_PUBLIC_ for client; MIN_ for server. */
export const MIN_STAKE_UST_FALLBACK = Number(
  process.env.NEXT_PUBLIC_MIN_STAKE_UST_FALLBACK ?? process.env.MIN_STAKE_UST_FALLBACK ?? "50"
);
export const FLAT_RATE_LABEL = "Standard";

/** Restake tier: 1.4% daily for 90 days (used when user restakes after unlock). */
export const RESTAKE_DAILY_BPS = 140;
export const RESTAKE_DAILY_PCT = 1.4;
export const RESTAKE_LABEL = "Restake";

export function getTier(amount: number, minUst?: number) {
  const min = minUst ?? MIN_STAKE_UST_FALLBACK;
  if (amount < min) return null;
  return {
    min: min,
    max: Infinity,
    dailyPct: DAILY_PCT,
    bps: DAILY_BPS,
    label: FLAT_RATE_LABEL,
  } as const;
}

export function computeReward(amount: number, dailyBps: number): number {
  return (amount * dailyBps * LOCK_DAYS) / 10_000;
}

/** L1 20%, L2 10%, L3 5% of referred user's staking rewards (paid hourly with their accrual). */
export const REFERRAL_LEVELS = [
  { level: 1, bps: 2000 },
  { level: 2, bps: 1000 },
  { level: 3, bps: 500 },
] as const;

export const REFERRAL_MIN_CLAIM_USD = Number(
  process.env.REFERRAL_MIN_CLAIM_USD || "10"
);

export const RAYDIUM_SOL_UST_POOL_ID =
  process.env.NEXT_PUBLIC_RAYDIUM_SOL_UST_POOL_ID || "";

/** WalletConnect Cloud project ID (https://cloud.walletconnect.com). Required for WalletConnect adapter. */
export const WALLETCONNECT_PROJECT_ID =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "";

/** App URL for WalletConnect metadata (e.g. https://ust-wallet.com). */
export const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  (typeof window !== "undefined" ? window.location.origin : "https://ust-wallet.com");

export function computeAccruedReward(
  amount: number,
  dailyBps: number,
  startTime: number,
  now: number
): number {
  const elapsedSeconds = Math.max(0, now - startTime);
  const elapsedDays = elapsedSeconds / 86_400;
  const cappedDays = Math.min(elapsedDays, LOCK_DAYS);
  return (amount * dailyBps * cappedDays) / 10_000;
}
