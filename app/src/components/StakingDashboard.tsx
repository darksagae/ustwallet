"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { Connection, type Transaction } from "@solana/web3.js";

const BaseWalletMultiButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then(
      (mod) => mod.BaseWalletMultiButton
    ),
  { ssr: false }
);
import {
  LOCK_DAYS,
  DAILY_BPS,
  DAILY_PCT,
  MIN_STAKE_USD,
  MIN_STAKE_UST_FALLBACK,
  RPC_FALLBACK_URL,
  RESTAKE_DAILY_PCT,
  computeReward,
  computeAccruedReward,
} from "@/lib/constants";
import {
  buildDepositTxWithAta,
  buildSolTransferTx,
  registerStake,
  registerStakeFromSol,
  fetchStakeFromApi,
  fetchReferralData,
  claimReferral,
  withdrawStake,
  restakeStake,
  StakeInfo,
  PoolInfo,
  ReferralInfo,
} from "@/lib/stakingClient";
import EmailSubscribe from "./EmailSubscribe";
import {
  IconCoins,
  IconCap,
  IconReward,
  IconReserved,
} from "./icons";

const CAP_DISPLAY = 5_000_000;
const UST_DECIMALS = 6;

/** Format raw UST (smallest units) as human-readable string, e.g. 818062833 -> "818.06" */
function formatUstRaw(raw: number): string {
  return (raw / 10 ** UST_DECIMALS).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function CountUp({ value, suffix = "" }: { value: number; suffix?: string }) {
  const [display, setDisplay] = useState(value);
  useEffect(() => {
    if (value === 0) {
      const frame = requestAnimationFrame(() => setDisplay(0));
      return () => cancelAnimationFrame(frame);
    }
    if (value === display) return;
    const step = Math.max(1, value / 25);
    let current = 0;
    const id = setInterval(() => {
      current += step;
      if (current >= value) {
        setDisplay(value);
        clearInterval(id);
      } else {
        setDisplay(Math.floor(current));
      }
    }, 40);
    return () => clearInterval(id);
  }, [value, display]);
  return (
    <>
      {display.toLocaleString()}
      {suffix}
    </>
  );
}

export default function StakingDashboard() {
  const { publicKey, sendTransaction, signTransaction, connected } = useWallet();
  const { connection } = useConnection();
  const searchParams = useSearchParams();

  const [payMode, setPayMode] = useState<"ust" | "sol">("ust");
  const [amount, setAmount] = useState("");
  const [solAmount, setSolAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [poolData, setPoolData] = useState<PoolInfo | null>(null);
  const [stakes, setStakes] = useState<StakeInfo[]>([]);
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  const [referralData, setReferralData] = useState<ReferralInfo | null>(null);
  const [claimLoading, setClaimLoading] = useState(false);
  const [withdrawDestination, setWithdrawDestination] = useState("");
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [restakeLoading, setRestakeLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [minUst, setMinUst] = useState(MIN_STAKE_UST_FALLBACK);
  const [minUsd, setMinUsd] = useState(MIN_STAKE_USD);

  const referrer = searchParams.get("ref") || undefined;

  function isRpcForbidden(err: unknown): boolean {
    const msg = (err as Error).message ?? "";
    return (
      msg.includes("403") ||
      msg.includes("Access forbidden") ||
      msg.includes("failed to get recent blockhash")
    );
  }

  function formatStakeError(err: unknown): string {
    const msg = (err as Error).message ?? "";
    const details =
      typeof (err as Error & { getLogs?: () => string[] }).getLogs === "function"
        ? (err as Error & { getLogs: () => string[] }).getLogs()?.join("\n") ?? ""
        : "";
    if (isRpcForbidden(err)) {
      return "RPC access forbidden. Set NEXT_PUBLIC_SOLANA_RPC_URL in .env to a dedicated RPC (e.g. Helius or QuickNode free tier).";
    }
    if (
      /signature\s*verification\s*failed|missing\s*signature\s*for\s*public\s*key/i.test(
        msg
      ) ||
      /signature\s*verification\s*failed|missing\s*signature\s*for\s*public\s*key/i.test(
        details
      )
    ) {
      return "Your wallet did not sign the transaction (often on mobile or when the wallet blocks the request). Try: (1) Use WalletConnect and approve in your mobile wallet, or (2) Approve the transaction when the wallet prompts you, or (3) Use a different browser/device.";
    }
    return details ? `${msg}\n${details}` : msg || "Transaction failed";
  }

  // #region agent log
  useEffect(() => {
    fetch("http://127.0.0.1:7461/ingest/6be44dbf-6d75-468a-9657-edaa08940de1", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "e39c62" },
      body: JSON.stringify({
        sessionId: "e39c62",
        location: "StakingDashboard.tsx:client-constants",
        message: "Client MIN_STAKE values at render",
        data: { MIN_STAKE_USD, MIN_STAKE_UST_FALLBACK },
        timestamp: Date.now(),
        hypothesisId: "H1",
      }),
    }).catch(() => {});
  }, []);
  // #endregion

  useEffect(() => {
    fetch("/api/stake/min")
      .then((r) => r.json())
      .then((data: { minUst?: number; minUsd?: number }) => {
        const setMinUstOk =
          typeof data.minUst === "number" && data.minUst >= 1;
        const setMinUsdOk =
          typeof data.minUsd === "number" && data.minUsd >= 1;
        // #region agent log
        fetch("http://127.0.0.1:7461/ingest/6be44dbf-6d75-468a-9657-edaa08940de1", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "e39c62" },
          body: JSON.stringify({
            sessionId: "e39c62",
            location: "StakingDashboard.tsx:api-stake-min-response",
            message: "API /api/stake/min response and update decision",
            data: {
              rawMinUst: data.minUst,
              rawMinUsd: data.minUsd,
              typeofMinUsd: typeof data.minUsd,
              setMinUstOk,
              setMinUsdOk,
            },
            timestamp: Date.now(),
            hypothesisId: "H2",
          }),
        }).catch(() => {});
        // #endregion
        if (setMinUstOk) {
          setMinUst(data.minUst!);
        }
        if (setMinUsdOk) {
          setMinUsd(data.minUsd!);
        }
      })
      .catch((err) => {
        // #region agent log
        fetch("http://127.0.0.1:7461/ingest/6be44dbf-6d75-468a-9657-edaa08940de1", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "e39c62" },
          body: JSON.stringify({
            sessionId: "e39c62",
            location: "StakingDashboard.tsx:api-stake-min-fetch-error",
            message: "Fetch /api/stake/min failed",
            data: { errMessage: (err as Error).message },
            timestamp: Date.now(),
            hypothesisId: "H1",
          }),
        }).catch(() => {});
        // #endregion
      });
  }, []);

  const refreshData = useCallback(async () => {
    if (!publicKey) return;
    const walletStr = publicKey.toBase58();
    try {
      const { stakes, pool } = await fetchStakeFromApi(walletStr);
      setStakes(stakes);
      setPoolData(pool);
    } catch {
      // may not exist yet
    }
    try {
      const refData = await fetchReferralData(walletStr);
      setReferralData(refData);
    } catch {
      // no referral data yet
    }
  }, [publicKey]);

  useEffect(() => {
    if (connected) refreshData();
  }, [connected, refreshData]);

  useEffect(() => {
    const interval = setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      10_000
    );
    return () => clearInterval(interval);
  }, []);

  const parsedAmount = parseFloat(amount) || 0;
  const meetsMin = parsedAmount >= minUst;
  const projectedReward = meetsMin ? computeReward(parsedAmount, DAILY_BPS) : 0;

  /** Prefer wallet sendTransaction (sign + send) to avoid "signature verification failed" when wallet blocks sign-only. */
  const sendAndConfirm = async (
    conn: Connection,
    tx: Transaction
  ): Promise<string> => {
    const { blockhash } = await conn.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    if (sendTransaction) {
      return sendTransaction(tx, conn, { skipPreflight: false });
    }
    if (signTransaction) {
      const signed = await signTransaction(tx);
      return conn.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
      });
    }
    throw new Error("Wallet does not support sending transactions");
  };

  const handleStake = async () => {
    setError("");
    setSuccess("");
    if (!publicKey || (!sendTransaction && !signTransaction)) {
      setError("Connect your wallet first");
      return;
    }
    if (!meetsMin) {
      setError(
        `Minimum stake is $${minUsd} USD equivalent (currently ~${minUst.toLocaleString()} UST)`
      );
      return;
    }
    setLoading(true);
    try {
      const tx = await buildDepositTxWithAta(
        connection,
        publicKey,
        parsedAmount
      );
      let signature: string;
      let conn: Connection = connection;
      try {
        signature = await sendAndConfirm(conn, tx);
      } catch (sendErr: unknown) {
        const msg = (sendErr as Error).message ?? "";
        if (isRpcForbidden(sendErr) && RPC_FALLBACK_URL) {
          conn = new Connection(RPC_FALLBACK_URL, "confirmed");
          signature = await sendAndConfirm(conn, tx);
        } else if (
          msg.includes("Blockhash not found") ||
          msg.includes("blockhash not found")
        ) {
          const txRetry = await buildDepositTxWithAta(
            connection,
            publicKey,
            parsedAmount
          );
          signature = await sendAndConfirm(conn, txRetry);
        } else {
          throw sendErr;
        }
      }
      await conn.confirmTransaction(signature, "confirmed");

      const stakeResult = await registerStake(
        publicKey.toBase58(),
        signature,
        parsedAmount,
        referrer
      );
      setSuccess(
        `Staked ${stakeResult.amount} UST at ${DAILY_PCT}% daily. Tx: ${signature}`
      );
      setAmount("");
      await refreshData();
    } catch (e: unknown) {
      setError(formatStakeError(e));
    } finally {
      setLoading(false);
    }
  };

  const handleStakeWithSol = async () => {
    setError("");
    setSuccess("");
    if (!publicKey || (!sendTransaction && !signTransaction)) {
      setError("Connect your wallet first");
      return;
    }
    const sol = parseFloat(solAmount) || 0;
    if (sol <= 0) {
      setError("Enter a valid SOL amount");
      return;
    }
    console.log("[Stake-SOL] Starting stake with SOL:", sol, "wallet:", publicKey.toBase58().slice(0, 8) + "...");
    setLoading(true);
    try {
      let tx = buildSolTransferTx(publicKey, sol);
      console.log("[Stake-SOL] Tx built, waiting for wallet signature...");
      let signature: string;
      let conn: Connection = connection;
      try {
        signature = await sendAndConfirm(conn, tx);
      } catch (sendErr: unknown) {
        const msg = (sendErr as Error).message ?? "";
        if (isRpcForbidden(sendErr) && RPC_FALLBACK_URL) {
          console.log("[Stake-SOL] Primary RPC failed, retrying with fallback...");
          conn = new Connection(RPC_FALLBACK_URL, "confirmed");
          signature = await sendAndConfirm(conn, tx);
        } else if (
          msg.includes("Blockhash not found") ||
          msg.includes("blockhash not found")
        ) {
          console.log("[Stake-SOL] Blockhash expired, retrying with fresh blockhash...");
          tx = buildSolTransferTx(publicKey, sol);
          signature = await sendAndConfirm(conn, tx);
        } else {
          throw sendErr;
        }
      }
      console.log("[Stake-SOL] Tx sent:", signature);
      await conn.confirmTransaction(signature, "confirmed");
      console.log("[Stake-SOL] Tx confirmed on-chain");

      console.log("[Stake-SOL] Calling /api/stake-sol to register stake...");
      const stakeResult = await registerStakeFromSol(
        publicKey.toBase58(),
        signature,
        referrer
      );
      console.log("[Stake-SOL] Stake registered:", stakeResult.id, "amount:", stakeResult.amount / 1_000_000, "UST");
      setSuccess(
        `Staked ${sol} SOL → ${(stakeResult.amount / 1_000_000).toFixed(2)} UST at ${DAILY_PCT}% daily. Tx: ${signature}`
      );
      setSolAmount("");
      await refreshData();
    } catch (e: unknown) {
      const err = e as Error & { getLogs?: () => string[] };
      console.log("[Stake-SOL] Error:", err.message);
      setError(formatStakeError(e));
    } finally {
      setLoading(false);
    }
  };

  const hasStakes = stakes.length > 0;
  const totalStakeAmount = stakes.reduce((sum, s) => sum + s.amount, 0);

  const anyActiveStake = stakes.some((s) => s.status === "active");

  const poolTotalStaked = poolData?.totalStaked ?? 0;
  const poolCap = poolData?.capTotalStaked ?? CAP_DISPLAY;
  const poolRewardMax = poolData?.rewardPoolMax ?? 0;
  const poolRewardReserved = poolData?.rewardPoolReserved ?? 0;
  const capPct =
    poolCap > 0 ? Math.min(100, (poolTotalStaked / poolCap) * 100) : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-emerald-950/30 to-slate-900 text-slate-100">
      <header className="flex items-center justify-between px-6 py-4 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-green-500 flex items-center justify-center font-bold text-lg shadow-lg shadow-emerald-500/25">
            U
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">UST Wallet</h1>
            <p className="text-xs text-slate-500">Season 1 Lock Event</p>
          </div>
        </div>
        <BaseWalletMultiButton
          labels={{
            "has-wallet": "Select Wallet",
            "no-wallet": "Select Wallet",
            connecting: "Connecting ...",
            "copy-address": "Copy address",
            copied: "Copied",
            "change-wallet": "Change wallet",
            disconnect: "Disconnect",
          }}
        />
      </header>

      {/* Hero */}
      <section className="max-w-4xl mx-auto px-6 pt-16 pb-12 text-center relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-20">
          <svg
            viewBox="0 0 200 200"
            className="w-64 h-64 md:w-80 md:h-80 text-emerald-500/50"
          >
            <circle
              cx="100"
              cy="100"
              r="60"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              strokeDasharray="4 4"
            />
            <circle
              cx="100"
              cy="100"
              r="40"
              fill="none"
              stroke="currentColor"
              strokeWidth="0.5"
            />
            <path
              d="M100 50 Q140 100 100 150 Q60 100 100 50"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              opacity="0.6"
            />
            <path
              d="M50 100 Q100 60 150 100 Q100 140 50 100"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              opacity="0.6"
            />
          </svg>
        </div>
        <h1 className="text-4xl md:text-5xl lg:text-6xl font-black tracking-tight mb-3 relative">
          <span className="block text-white">90-Day UST Lock</span>
          <span className="block text-emerald-400 glow-emerald">
            Earn {DAILY_PCT}% Daily — {DAILY_PCT * LOCK_DAYS}% Total
          </span>
        </h1>
        <p className="text-slate-400 text-lg mb-8">
          Limited Supply Lock Event — Only {CAP_DISPLAY.toLocaleString()} UST
          Cap
        </p>
        <div className="flex justify-center mb-12">
          <div className="[&_button]:!h-14 [&_button]:!px-10 [&_button]:!text-lg">
            <BaseWalletMultiButton
              labels={{
                "has-wallet": "Select Wallet",
                "no-wallet": "Select Wallet",
                connecting: "Connecting ...",
                "copy-address": "Copy address",
                copied: "Copied",
                "change-wallet": "Change wallet",
                disconnect: "Disconnect",
              }}
            />
          </div>
        </div>

        {/* Cap Progress */}
        <div className="bg-slate-900/50 backdrop-blur-md border border-emerald-500/20 rounded-2xl p-6 glow-card">
          <p className="text-slate-400 text-sm mb-2">
            {poolCap.toLocaleString()} UST Max
          </p>
          <div className="h-4 bg-slate-800 rounded-full overflow-hidden mb-2">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-green-400 transition-all duration-700 rounded-full"
              style={{ width: `${capPct}%` }}
            />
          </div>
          <p className="text-lg font-bold text-white">
            {capPct === 0 ? (
              <span className="text-slate-500">
                0% Filled — Be First To Lock
              </span>
            ) : (
              <CountUp value={Math.round(capPct)} suffix="% Filled" />
            )}
          </p>
        </div>

        {/* Stats — values are raw (smallest units); display as UST with 2 decimals */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8">
          <StatCard
            icon={<IconCoins className="w-8 h-8 text-emerald-400" />}
            label="Total Staked"
            value={poolTotalStaked}
            suffix=" UST"
            formatAsUst
          />
          <StatCard
            icon={<IconCap className="w-8 h-8 text-emerald-400" />}
            label="Staking Cap"
            value={poolCap}
            suffix=" UST"
            formatAsUst
          />
          <StatCard
            icon={<IconReward className="w-8 h-8 text-emerald-400" />}
            label="Reward Pool"
            value={poolRewardMax}
            suffix=" UST"
            formatAsUst
          />
          <StatCard
            icon={<IconReserved className="w-8 h-8 text-emerald-400" />}
            label="Reserved"
            value={poolRewardReserved}
            suffix=" UST"
            formatAsUst
          />
        </div>
      </section>

      <main className="max-w-6xl mx-auto px-6 py-10 grid gap-8 lg:grid-cols-3">
        {/* Staking Form */}
        <div className="lg:col-span-2 bg-slate-900/50 backdrop-blur-md border border-emerald-500/20 rounded-2xl p-6 glow-card animate-float">
          {/* Pay Mode Tabs */}
          <div className="flex gap-2 mb-6">
            <button
              onClick={() => setPayMode("ust")}
              className={`flex-1 py-2.5 rounded-xl font-semibold text-sm transition-all ${
                payMode === "ust"
                  ? "bg-emerald-600 text-white shadow-lg shadow-emerald-500/30"
                  : "bg-slate-800/60 text-slate-400 hover:text-white hover:bg-slate-700/60"
              }`}
            >
              Stake with UST
            </button>
            <button
              onClick={() => setPayMode("sol")}
              className={`flex-1 py-2.5 rounded-xl font-semibold text-sm transition-all ${
                payMode === "sol"
                  ? "bg-emerald-600 text-white shadow-lg shadow-emerald-500/30"
                  : "bg-slate-800/60 text-slate-400 hover:text-white hover:bg-slate-700/60"
              }`}
            >
              Stake with SOL
            </button>
          </div>

          {payMode === "ust" ? (
            <>
              <h2 className="text-xl font-bold mb-6 text-white">Stake UST</h2>
              <div className="mb-4">
                <label className="block text-sm text-slate-400 mb-1">
                  Amount (UST)
                </label>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={`Min ${minUst.toLocaleString()} UST ($${minUsd} USD)`}
                  className="w-full px-4 py-3 bg-slate-800/80 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
                  disabled={loading}
                />
              </div>

              {meetsMin && (
                <div className="mb-6 p-4 bg-emerald-950/30 rounded-xl border border-emerald-500/20">
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-slate-400">Daily Return</span>
                    <span className="text-emerald-400 text-lg font-bold glow-emerald">
                      {DAILY_PCT}%
                    </span>
                  </div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-slate-400">Lock Period</span>
                    <span>{LOCK_DAYS} days</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">
                      Projected Total Reward
                    </span>
                    <span className="text-emerald-400 font-bold">
                      {projectedReward.toFixed(2)} UST
                    </span>
                  </div>
                </div>
              )}

              <button
                onClick={handleStake}
                disabled={loading || !connected || !meetsMin}
                className="w-full py-4 rounded-xl font-bold text-lg bg-gradient-to-r from-emerald-600 to-green-500 hover:from-emerald-500 hover:to-green-400 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-emerald-500/30 hover:shadow-emerald-500/50 hover:-translate-y-0.5"
              >
                {loading ? "Processing..." : "Stake UST"}
              </button>
            </>
          ) : (
            <>
              <h2 className="text-xl font-bold mb-6 text-white">
                Stake with SOL
              </h2>
              <div className="mb-4">
                <label className="block text-sm text-slate-400 mb-1">
                  Amount (SOL)
                </label>
                <input
                  type="number"
                  value={solAmount}
                  onChange={(e) => setSolAmount(e.target.value)}
                  placeholder="Enter SOL amount"
                  step="0.01"
                  className="w-full px-4 py-3 bg-slate-800/80 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
                  disabled={loading}
                />
              </div>

              <button
                onClick={handleStakeWithSol}
                disabled={
                  loading || !connected || (parseFloat(solAmount) || 0) <= 0
                }
                className="w-full py-4 rounded-xl font-bold text-lg bg-gradient-to-r from-emerald-600 to-green-500 hover:from-emerald-500 hover:to-green-400 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-emerald-500/30 hover:shadow-emerald-500/50 hover:-translate-y-0.5"
              >
                {loading ? "Processing..." : "Stake with SOL"}
              </button>
            </>
          )}

          {error && (
            <p className="mt-3 text-sm text-red-400 bg-red-950/30 px-4 py-2 rounded-lg">
              {error}
            </p>
          )}
          {success && (
            <p className="mt-3 text-sm text-emerald-400 bg-emerald-950/30 px-4 py-2 rounded-lg break-all">
              {success}
            </p>
          )}

          {/* Rate Card */}
          <div className="mt-8">
            <div className="p-5 rounded-xl border border-emerald-500/20 bg-slate-800/50">
              <p className="text-2xl font-bold text-emerald-400 glow-emerald mb-1">
                {DAILY_PCT}% Daily
              </p>
              <p className="text-slate-400 text-sm">
                {DAILY_PCT * LOCK_DAYS}% total over {LOCK_DAYS} days &middot; Min ${minUsd} USD (≈{minUst.toLocaleString()} UST)
              </p>
            </div>
          </div>
        </div>

        {/* Active Position */}
        <div className="space-y-6">
          <div className="bg-slate-900/50 backdrop-blur-md border border-emerald-500/20 rounded-2xl p-6 glow-card">
            <h2 className="text-xl font-bold mb-4 text-white">
              Your Position
            </h2>

            {!connected ? (
              <p className="text-slate-500 text-sm">
                Connect your wallet to view your position.
              </p>
            ) : !hasStakes ? (
              <p className="text-slate-500 text-sm">
                No active or unlocked stakes found.
              </p>
            ) : (
              <div className="space-y-4">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Total Staked</span>
                  <span className="font-semibold">
                    {formatUstRaw(totalStakeAmount)} UST
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  {stakes.length} active/unlocked{" "}
                  {stakes.length === 1 ? "position" : "positions"}.
                </p>

                <div className="mt-2 space-y-4">
                  {stakes.map((s) => {
                    const stakeAccrued =
                      s.status === "active"
                        ? computeAccruedReward(
                            s.amount,
                            s.tierBps,
                            s.startTime,
                            now
                          )
                        : 0;
                    const daysRemaining = Math.max(
                      0,
                      Math.ceil((s.unlockTime - now) / 86400)
                    );
                    const isUnlocked = s.status === "unlocked";

                    return (
                      <div
                        key={s.id}
                        className="p-4 rounded-xl border border-emerald-500/15 bg-slate-900/60 space-y-3"
                      >
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-400">Staked</span>
                          <span className="font-semibold">
                            {formatUstRaw(s.amount)} UST
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-400">Rate</span>
                          <span>{(s.tierBps / 100).toFixed(1)}% daily</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-400">
                            Total Reward at Unlock
                          </span>
                          <span className="text-emerald-400">
                            {formatUstRaw(s.totalReward)} UST
                          </span>
                        </div>

                        <div className="p-3 bg-gradient-to-br from-emerald-950/40 to-indigo-950/40 rounded-xl border border-emerald-500/20 mt-1">
                          <p className="text-[11px] text-slate-400 mb-1">
                            Accrued So Far
                          </p>
                          <p className="text-xl font-bold text-emerald-400 glow-emerald">
                            {formatUstRaw(stakeAccrued)} UST
                          </p>
                        </div>

                        {s.status === "active" && s.amount > 0 && (
                          <div className="mt-2">
                            <p className="text-xs text-slate-400 mb-1">
                              Progress to Unlock
                            </p>
                            <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-emerald-500 rounded-full transition-all"
                                style={{
                                  width: `${Math.min(
                                    100,
                                    ((now - s.startTime) /
                                      (86400 * LOCK_DAYS)) *
                                      100
                                  )}%`,
                                }}
                              />
                            </div>
                          </div>
                        )}

                        <div className="flex justify-between text-sm">
                          <span className="text-slate-400">Unlock In</span>
                          <span
                            className={
                              daysRemaining === 0
                                ? "text-emerald-400"
                                : "text-amber-400"
                            }
                          >
                            {daysRemaining === 0
                              ? "Unlocked!"
                              : `${daysRemaining} days`}
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-400">Unlock Date</span>
                          <span>
                            {new Date(s.unlockTime * 1000).toLocaleDateString()}
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-400">Status</span>
                          <span
                            className={
                              s.status === "claimed"
                                ? "text-slate-500"
                                : "text-emerald-400"
                            }
                          >
                            {s.status === "active"
                              ? "Locked"
                              : s.status === "unlocked"
                              ? "Unlocked — choose Withdraw or Restake"
                              : "Claimed"}
                          </span>
                        </div>

                        {s.childWallet && (
                          <div className="flex justify-between text-sm">
                            <span className="text-slate-400">Child Wallet</span>
                            <a
                              href={`https://explorer.solana.com/address/${s.childWallet}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-emerald-400 hover:underline font-mono text-xs"
                            >
                              {s.childWallet.slice(0, 6)}...
                              {s.childWallet.slice(-4)}
                            </a>
                          </div>
                        )}

                        {daysRemaining === 0 && s.status === "active" && (
                          <p className="text-sm text-emerald-300 mt-2 bg-emerald-950/30 px-3 py-2 rounded-lg">
                            When unlocked, you can withdraw to your wallet or
                            restake at {RESTAKE_DAILY_PCT}% for another 90 days.
                          </p>
                        )}

                        {isUnlocked && s.childWallet && (
                          <div className="mt-4 space-y-3 p-4 bg-slate-800/50 rounded-xl border border-emerald-500/20">
                            <p className="text-sm text-slate-300">
                              Choose how to use your staked amount + rewards:
                            </p>
                            <div>
                              <label className="block text-xs text-slate-400 mb-1">
                                Withdraw to address (leave empty for connected
                                wallet)
                              </label>
                              <input
                                type="text"
                                value={withdrawDestination}
                                onChange={(e) =>
                                  setWithdrawDestination(e.target.value)
                                }
                                placeholder={
                                  publicKey?.toBase58() ?? "Wallet address"
                                }
                                className="w-full px-3 py-2 bg-slate-800 border border-white/10 rounded-lg text-white font-mono text-sm placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                                disabled={withdrawLoading || restakeLoading}
                              />
                            </div>
                            <div className="flex gap-2 flex-wrap">
                              <button
                                onClick={async () => {
                                  if (!publicKey) return;
                                  setError("");
                                  setSuccess("");
                                  setWithdrawLoading(true);
                                  try {
                                    const result = await withdrawStake(
                                      s.id,
                                      publicKey.toBase58(),
                                      withdrawDestination.trim() || undefined
                                    );
                                    setSuccess(
                                      `Withdrawn ${(Number(result.amount) / 1_000_000).toFixed(
                                        2
                                      )} UST + ${(Number(result.totalReward) / 1_000_000).toFixed(
                                        2
                                      )} rewards. Tx: ${result.txSignature}`
                                    );
                                    await refreshData();
                                  } catch (e) {
                                    setError(
                                      (e as Error).message ?? "Withdraw failed"
                                    );
                                  } finally {
                                    setWithdrawLoading(false);
                                  }
                                }}
                                disabled={withdrawLoading || restakeLoading}
                                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-semibold text-sm disabled:opacity-50 disabled:pointer-events-none"
                              >
                                {withdrawLoading
                                  ? "Withdrawing…"
                                  : "Withdraw"}
                              </button>
                              <button
                                onClick={async () => {
                                  if (!publicKey) return;
                                  setError("");
                                  setSuccess("");
                                  setRestakeLoading(true);
                                  try {
                                    const result = await restakeStake(
                                      s.id,
                                      publicKey.toBase58()
                                    );
                                    setSuccess(
                                      `Restaked ${(Number(result.amount) / 1_000_000).toFixed(
                                        2
                                      )} UST at ${result.tierLabel} (${RESTAKE_DAILY_PCT}% daily) for 90 days.`
                                    );
                                    await refreshData();
                                  } catch (e) {
                                    setError(
                                      (e as Error).message ?? "Restake failed"
                                    );
                                  } finally {
                                    setRestakeLoading(false);
                                  }
                                }}
                                disabled={withdrawLoading || restakeLoading}
                                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-semibold text-sm disabled:opacity-50 disabled:pointer-events-none"
                              >
                                {restakeLoading
                                  ? "Restaking…"
                                  : `Restake at ${RESTAKE_DAILY_PCT}%`}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {connected && anyActiveStake && (
            <EmailSubscribe wallet={publicKey?.toBase58() || ""} />
          )}
        </div>
      </main>

      {/* Referral Section */}
      {connected && publicKey && (
        <section className="max-w-6xl mx-auto px-6 pb-10">
          <div className="bg-slate-900/50 backdrop-blur-md border border-emerald-500/20 rounded-2xl p-6 glow-card">
            <h2 className="text-xl font-bold mb-6 text-white">
              Referral Program
            </h2>
            <p className="text-slate-400 text-sm mb-4">
              Earn 0.2% (L1), 0.1% (L2), and 0.05% (L3) of your
              referrals&apos; daily staking rewards. No lock-up — claim
              anytime (min $10 USD).
            </p>

            {/* Referral Link */}
            <div className="mb-6">
              <label className="block text-sm text-slate-400 mb-1">
                Your Referral Link
              </label>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={`${typeof window !== "undefined" ? window.location.origin : ""}/?ref=${publicKey.toBase58()}`}
                  className="flex-1 px-4 py-3 bg-slate-800/80 border border-white/10 rounded-xl text-white font-mono text-xs focus:outline-none"
                />
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(
                      `${window.location.origin}/?ref=${publicKey.toBase58()}`
                    );
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-semibold text-sm transition-colors"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <div className="bg-slate-800/50 rounded-xl p-4 border border-emerald-500/10">
                <p className="text-xs text-slate-500 mb-1">Referrals</p>
                <p className="text-lg font-bold text-white">
                  {referralData?.referrals.length ?? 0}
                </p>
              </div>
              <div className="bg-slate-800/50 rounded-xl p-4 border border-emerald-500/10">
                <p className="text-xs text-slate-500 mb-1">Total Earned</p>
                <p className="text-lg font-bold text-emerald-400">
                  {((referralData?.totalEarned ?? 0) / 1_000_000).toFixed(2)}{" "}
                  UST
                </p>
              </div>
              <div className="bg-slate-800/50 rounded-xl p-4 border border-emerald-500/10">
                <p className="text-xs text-slate-500 mb-1">Claimable</p>
                <p className="text-lg font-bold text-emerald-400">
                  {((referralData?.balance ?? 0) / 1_000_000).toFixed(2)} UST
                </p>
              </div>
            </div>

            {/* Claim Button */}
            <button
              onClick={async () => {
                if (!publicKey) return;
                setClaimLoading(true);
                setError("");
                setSuccess("");
                try {
                  const result = await claimReferral(publicKey.toBase58());
                  setSuccess(
                    `Claimed ${(result.claimed / 1_000_000).toFixed(2)} UST (~$${result.claimedUsd}). Tx: ${result.txSignature}`
                  );
                  await refreshData();
                } catch (e: unknown) {
                  setError((e as Error).message || "Claim failed");
                } finally {
                  setClaimLoading(false);
                }
              }}
              disabled={
                claimLoading ||
                (referralData?.balance ?? 0) / 1_000_000 < 10
              }
              className="w-full py-3 rounded-xl font-bold bg-gradient-to-r from-emerald-600 to-green-500 hover:from-emerald-500 hover:to-green-400 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-emerald-500/30 mb-6"
            >
              {claimLoading
                ? "Claiming..."
                : `Claim Referral Rewards (min $10)`}
            </button>

            {/* Recent Accruals */}
            {referralData &&
              referralData.recentAccruals.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-400 mb-3">
                    Recent Referral Earnings
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-slate-500 text-xs border-b border-white/5">
                          <th className="text-left py-2 pr-4">Level</th>
                          <th className="text-left py-2 pr-4">Amount</th>
                          <th className="text-left py-2 pr-4">From</th>
                          <th className="text-left py-2">Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {referralData.recentAccruals.map((a, i) => (
                          <tr
                            key={i}
                            className="border-b border-white/5 text-slate-300"
                          >
                            <td className="py-2 pr-4">
                              <span
                                className={
                                  a.level === 1
                                    ? "text-emerald-400"
                                    : a.level === 2
                                    ? "text-blue-400"
                                    : "text-purple-400"
                                }
                              >
                                L{a.level}
                              </span>
                            </td>
                            <td className="py-2 pr-4 font-mono">
                              {(a.amount / 1_000_000).toFixed(4)} UST
                            </td>
                            <td className="py-2 pr-4 font-mono text-xs">
                              {a.sourceWallet.slice(0, 4)}...
                              {a.sourceWallet.slice(-4)}
                            </td>
                            <td className="py-2 text-xs text-slate-500">
                              {new Date(a.createdAt).toLocaleDateString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

            {/* Referral List */}
            {referralData &&
              referralData.referrals.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-sm font-semibold text-slate-400 mb-3">
                    Your Referrals
                  </h3>
                  <div className="space-y-2">
                    {referralData.referrals.map((r) => (
                      <div
                        key={r.wallet}
                        className="flex justify-between items-center text-sm bg-slate-800/30 px-4 py-2 rounded-lg"
                      >
                        <span className="font-mono text-xs text-slate-300">
                          {r.wallet.slice(0, 6)}...{r.wallet.slice(-4)}
                        </span>
                        <span className="text-xs text-slate-500">
                          {new Date(r.joinedAt).toLocaleDateString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
          </div>
        </section>
      )}

      <footer className="border-t border-white/5 py-6 text-center text-xs text-slate-600">
        UST Wallet · Season 1 Lock Event · 90-Day Supply Lock
      </footer>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  suffix,
  formatAsUst = false,
}: {
  icon?: React.ReactNode;
  label: string;
  value: number;
  suffix: string;
  formatAsUst?: boolean;
}) {
  const displayValue =
    formatAsUst && value > 0 ? formatUstRaw(value) : value > 0 ? undefined : null;
  return (
    <div className="bg-slate-900/50 backdrop-blur-md border border-emerald-500/20 rounded-xl p-4 glow-card flex gap-4 items-start">
      {icon && <div className="flex-shrink-0 mt-0.5">{icon}</div>}
      <div className="min-w-0">
        <p className="text-xs text-slate-500 mb-1">{label}</p>
        <p className="text-lg font-bold text-white">
          {displayValue !== null ? (
            displayValue !== undefined ? (
              <>{displayValue}{suffix}</>
            ) : (
              <CountUp value={value} suffix={suffix} />
            )
          ) : (
            <>0{suffix}</>
          )}
        </p>
      </div>
    </div>
  );
}
