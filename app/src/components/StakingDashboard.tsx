"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
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

const WalletModalButton = dynamic(
  () =>
    import("@solana/wallet-adapter-react-ui").then(
      (mod) => mod.WalletModalButton
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
  APP_URL,
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
  IconReward,
  IconReserved,
} from "./icons";

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
  const { publicKey, sendTransaction, signTransaction, connected, connecting } =
    useWallet();
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
  const [minSol, setMinSol] = useState(0);
  const [solPriceUsd, setSolPriceUsd] = useState(0);
  const [manualReferrer, setManualReferrer] = useState("");

  const referrer = searchParams.get("ref") || manualReferrer.trim() || undefined;

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

  useEffect(() => {
    fetch("/api/stake/min")
      .then((r) => r.json())
      .then(
        (data: {
          minUst?: number;
          minUsd?: number;
          minSol?: number;
          solPriceUsd?: number;
        }) => {
          if (typeof data.minUst === "number" && data.minUst >= 1)
            setMinUst(data.minUst);
          if (typeof data.minUsd === "number" && data.minUsd >= 1)
            setMinUsd(data.minUsd);
          if (typeof data.minSol === "number" && data.minSol > 0)
            setMinSol(data.minSol);
          if (typeof data.solPriceUsd === "number" && data.solPriceUsd > 0)
            setSolPriceUsd(data.solPriceUsd);
        }
      )
      .catch(() => {});
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
  /** UST transfer uses raw units (6 decimals). User types human amount (e.g. 100). */
  const amountRaw = Math.round(parsedAmount * 1_000_000);

  /** Prefer wallet sendTransaction (sign + send) to avoid "signature verification failed" when wallet blocks sign-only. */
  const sendAndConfirm = async (
    conn: Connection,
    tx: Transaction
  ): Promise<string> => {
    const { blockhash, lastValidBlockHeight } =
      await conn.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    let signature: string;
    if (sendTransaction) {
      signature = await sendTransaction(tx, conn, {
        skipPreflight: false,
        maxRetries: 3,
      });
    } else if (signTransaction) {
      const signed = await signTransaction(tx);
      signature = await conn.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });
    } else {
      throw new Error("Wallet does not support sending transactions");
    }
    await conn.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      "confirmed"
    );
    return signature;
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
        `Minimum stake is $${minUsd} USD worth of UST (≈${minUst.toLocaleString()} UST). You entered ${parsedAmount.toFixed(2)} UST.`
      );
      return;
    }
    setLoading(true);
    try {
      const tx = await buildDepositTxWithAta(
        connection,
        publicKey,
        amountRaw
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
            amountRaw
          );
          signature = await sendAndConfirm(conn, txRetry);
        } else {
          throw sendErr;
        }
      }

      const stakeResult = await registerStake(
        publicKey.toBase58(),
        signature,
        amountRaw,
        referrer
      );
      setSuccess(
        `Staked ${(stakeResult.amount / 1_000_000).toFixed(2)} UST at ${DAILY_PCT}% daily. Tx: ${signature}`
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
    if (solPriceUsd > 0) {
      const solUsd = sol * solPriceUsd;
      if (solUsd < minUsd) {
        const approxMinSol =
          minSol > 0 ? minSol : solPriceUsd > 0 ? minUsd / solPriceUsd : 0;
        setError(
          `Minimum stake is $${minUsd} USD equivalent (currently ~${approxMinSol.toFixed(
            3
          )} SOL). You entered ~$${solUsd.toFixed(2)}.`
        );
        return;
      }
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
  const poolRewardMax = poolData?.rewardPoolMax ?? 0;
  const poolRewardReserved = poolData?.rewardPoolReserved ?? 0;

  // Accrued progress toward 90-day goal: (tokens received so far) / (total 90-day reward goal)
  // accrued from API is in raw units; totalReward is in human UST
  const totalAccruedRaw = stakes.reduce((sum, s) => sum + s.accrued, 0);
  const totalGoalHuman = stakes.reduce((sum, s) => sum + s.totalReward, 0);
  const totalAccruedHuman = totalAccruedRaw / 1_000_000;
  const accruedProgressPct =
    totalGoalHuman > 0 ? Math.min(100, (totalAccruedHuman / totalGoalHuman) * 100) : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-emerald-950/30 to-slate-900 text-slate-100 relative">
      {/* Fixed background globe — stays in place while page scrolls */}
      <div
        className="fixed inset-0 pointer-events-none flex items-center justify-center overflow-hidden z-0"
        aria-hidden
      >
        <div
          className="w-[320px] h-[320px] md:w-[400px] md:h-[400px] rounded-full overflow-hidden opacity-25"
          style={{
            boxShadow: "inset -15px -15px 30px rgba(0,0,0,0.3), 0 0 0 1px rgba(16, 185, 129, 0.15)",
          }}
        >
          <div
            className="h-full w-[200%] bg-slate-800"
            style={{
              backgroundImage: `url("https://upload.wikimedia.org/wikipedia/commons/8/83/Equirectangular_projection_SW.jpg")`,
              backgroundSize: "50% 100%",
              backgroundRepeat: "repeat-x",
              backgroundPosition: "0 0",
              animation: "globe-rotate 40s linear infinite",
            }}
          />
        </div>
      </div>

      <div className="relative z-10">
      <header className="flex items-center justify-between px-6 py-4 border-b border-white/5">
        <div className="flex items-center gap-3">
          <Image
            src="/tokenlogo.png"
            alt="UST Wallet"
            width={40}
            height={40}
            className="w-10 h-10 rounded-xl object-cover shadow-lg shadow-emerald-500/25"
          />
          <div>
            <h1 className="text-xl font-bold text-white">UST Wallet</h1>
            <p className="text-xs text-slate-500">Season 1 Lock Event</p>
          </div>
        </div>
        {connected ? (
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
        ) : connecting ? (
          <button className="wallet-adapter-button wallet-adapter-button-trigger" disabled>
            Connecting ...
          </button>
        ) : (
          <WalletModalButton>Select Wallet</WalletModalButton>
        )}
      </header>

      {/* Hero */}
      <section className="max-w-4xl mx-auto px-6 pt-16 pb-12 text-center relative">
        <div className="flex justify-center mb-4">
          <Image
            src="/tokenlogo.png"
            alt="UST"
            width={80}
            height={80}
            className="rounded-2xl"
          />
        </div>
        <h1 className="text-4xl md:text-5xl lg:text-6xl font-black tracking-tight mb-3 relative">
          <span className="block text-white">90-Day UST Lock</span>
          <span className="block text-emerald-400 glow-emerald">
            Earn {DAILY_PCT}% Daily — {DAILY_PCT * LOCK_DAYS}% Total
          </span>
        </h1>
        <p className="text-slate-400 text-lg mb-8">
          Limited Supply Lock Event
        </p>
        <div className="flex justify-center mb-12">
          <div className="[&_button]:!h-14 [&_button]:!px-10 [&_button]:!text-lg">
            {connected ? (
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
            ) : connecting ? (
              <button className="wallet-adapter-button wallet-adapter-button-trigger" disabled>
                Connecting ...
              </button>
            ) : (
              <WalletModalButton>Select Wallet</WalletModalButton>
            )}
          </div>
        </div>

        {/* Accrued progress toward 90-day goal — dynamic based on tokens received */}
        {connected && (
          <div className="bg-slate-900/50 backdrop-blur-md border border-emerald-500/20 rounded-2xl p-6 glow-card">
            <p className="text-slate-400 text-sm mb-2">
              Accrued progress to reach your 90-day goal
            </p>
            <div className="h-4 bg-slate-800 rounded-full overflow-hidden mb-2">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-green-400 transition-all duration-700 rounded-full"
                style={{ width: `${accruedProgressPct}%` }}
              />
            </div>
            <p className="text-lg font-bold text-white">
              {stakes.length === 0 ? (
                <span className="text-slate-500">
                  Stake UST to see your progress
                </span>
              ) : totalGoalHuman === 0 ? (
                <span className="text-slate-500">0% — calculating goal</span>
              ) : (
                <>
                  <CountUp value={Math.round(accruedProgressPct)} suffix="% of your 90-day reward" />
                </>
              )}
            </p>
            <p className="text-xs text-slate-500 mt-2">
              {stakes.length > 0 && totalGoalHuman > 0
                ? `Tokens received: ${totalAccruedHuman.toFixed(2)} / ${totalGoalHuman.toFixed(2)} UST reward goal. Updates hourly.`
                : "Your accrued rewards below update every hour over the 90-day lock."}
            </p>
          </div>
        )}

        {/* Stats — values are raw (smallest units); display as UST with 2 decimals */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-8">
          <StatCard
            icon={<IconCoins className="w-8 h-8 text-emerald-400" />}
            label="Total Staked"
            value={poolTotalStaked}
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
          {/* Direct UST staking only — "Stake UST using SOL" disabled (sends to wrong address) */}
          <div className="mb-4">
            <label className="block text-sm text-slate-400 mb-1">
              Referral code (optional)
            </label>
            <input
              type="text"
              value={manualReferrer}
              onChange={(e) => setManualReferrer(e.target.value)}
              placeholder="Paste wallet address or code — applied when you stake"
              className="w-full px-4 py-2 bg-slate-800/80 border border-white/10 rounded-xl text-white text-sm placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <h2 className="text-xl font-bold mb-6 text-white">Stake UST</h2>
          <p className="text-slate-400 text-sm mb-4">
            You need UST in your wallet. Enter amount to send from your wallet.
          </p>
          <p className="text-amber-400/90 text-sm mb-4 font-medium">
            Minimum stake: ${minUsd} USD worth of UST (≈{minUst.toLocaleString()} UST).
          </p>
          <div className="mb-4">
            <label className="block text-sm text-slate-400 mb-1">
              Amount (UST)
            </label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={`Min ${minUst.toLocaleString()} UST`}
              min={minUst}
              step="any"
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
                {DAILY_PCT * LOCK_DAYS}% total over {LOCK_DAYS} days
              </p>
              <p className="text-slate-500 text-xs mt-1">
                Minimum: ${minUsd} USD worth of UST (≈{minUst.toLocaleString()} UST)
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
                    const isWithdrawPending = s.status === "withdraw_pending";

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
                                : s.status === "withdraw_pending"
                                ? "text-amber-400"
                                : "text-emerald-400"
                            }
                          >
                            {s.status === "active"
                              ? "Locked"
                              : s.status === "unlocked"
                              ? "Unlocked — choose Withdraw or Restake"
                              : s.status === "withdraw_pending"
                              ? "Withdrawal pending — waiting for confirmation"
                              : "Claimed"}
                          </span>
                        </div>

                        {daysRemaining === 0 && s.status === "active" && (
                          <p className="text-sm text-emerald-300 mt-2 bg-emerald-950/30 px-3 py-2 rounded-lg">
                            When unlocked, you can withdraw to your wallet or
                            restake at {RESTAKE_DAILY_PCT}% for another 90 days.
                          </p>
                        )}

                        {isWithdrawPending && (
                          <div className="mt-4 p-4 bg-amber-950/30 rounded-xl border border-amber-500/20">
                            <p className="text-sm text-amber-300">
                              Your withdrawal request has been submitted.
                              Waiting for confirmation — you will receive your
                              tokens shortly.
                            </p>
                          </div>
                        )}

                        {isUnlocked && (
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
                                    if (result.status === "pending") {
                                      setSuccess(
                                        result.message ??
                                          "Withdrawal requested. Waiting for confirmation."
                                      );
                                    } else {
                                      setSuccess(
                                        `Withdrawn ${(Number(result.amount) / 1_000_000).toFixed(
                                          2
                                        )} UST. Tx: ${result.txSignature}`
                                      );
                                    }
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
              Earn 20% of L1, 10% of L2, and 5% of L3 referrals&apos; staking
              rewards. Paid hourly when they earn. No lock-up — claim anytime
              (min $10 USD). Referrals count only when the referred user
              successfully stakes.
            </p>

            {/* Referral Link — use app base URL so link works when shared */}
            <div className="mb-6">
              <label className="block text-sm text-slate-400 mb-1">
                Your Referral Link
              </label>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={`${typeof window !== "undefined" ? APP_URL : "https://ust-wallet.com"}/?ref=${publicKey.toBase58()}`}
                  className="flex-1 px-4 py-3 bg-slate-800/80 border border-white/10 rounded-xl text-white font-mono text-xs focus:outline-none"
                />
                <button
                  onClick={() => {
                    const link = `${typeof window !== "undefined" ? APP_URL : "https://ust-wallet.com"}/?ref=${publicKey.toBase58()}`;
                    navigator.clipboard.writeText(link);
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
                  if (result.status === "pending") {
                    setSuccess(
                      result.message ??
                        `Claim requested for ${(result.claimed / 1_000_000).toFixed(2)} UST (~$${result.claimedUsd}). Waiting for confirmation.`
                    );
                  } else {
                    setSuccess(
                      `Claimed ${(result.claimed / 1_000_000).toFixed(2)} UST (~$${result.claimedUsd}). Tx: ${result.txSignature}`
                    );
                  }
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
