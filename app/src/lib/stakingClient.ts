import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
} from "@solana/spl-token";
import { UST_MINT } from "./constants";

function getMainWallet(): PublicKey {
  const key = process.env.NEXT_PUBLIC_MAIN_WALLET;
  if (!key || key === "11111111111111111111111111111111") {
    throw new Error("NEXT_PUBLIC_MAIN_WALLET is not configured");
  }
  return new PublicKey(key);
}


export interface StakeInfo {
  id: string;
  wallet: string;
  amount: number;
  tierBps: number;
  tierLabel: string;
  startTime: number;
  unlockTime: number;
  totalReward: number;
  rewardDistributed: number;
  accrued: number;
  status: string;
  childWallet: string | null;
  depositTxSig: string;
  claimTxSig: string | null;
}

export interface PoolInfo {
  totalStaked: number;
  capTotalStaked: number;
  rewardPoolMax: number;
  rewardPoolReserved: number;
}

export function buildDepositTx(
  connection: Connection,
  userPubkey: PublicKey,
  amount: number
): Transaction {
  const userAta = getAssociatedTokenAddressSync(UST_MINT, userPubkey);
  const mainWallet = getMainWallet();
  const mainAta = getAssociatedTokenAddressSync(UST_MINT, mainWallet);

  const tx = new Transaction();
  tx.add(
    createTransferInstruction(
      userAta,
      mainAta,
      userPubkey,
      BigInt(amount),
      [],
      TOKEN_PROGRAM_ID
    )
  );
  tx.feePayer = userPubkey;

  return tx;
}

export async function buildDepositTxWithAta(
  connection: Connection,
  userPubkey: PublicKey,
  amount: number
): Promise<Transaction> {
  const userAta = getAssociatedTokenAddressSync(UST_MINT, userPubkey);
  const mainWallet = getMainWallet();
  const mainAta = getAssociatedTokenAddressSync(UST_MINT, mainWallet);

  const tx = new Transaction();

  const mainAtaInfo = await connection.getAccountInfo(mainAta);
  if (!mainAtaInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        userPubkey,
        mainAta,
        mainWallet,
        UST_MINT
      )
    );
  }

  tx.add(
    createTransferInstruction(
      userAta,
      mainAta,
      userPubkey,
      BigInt(amount),
      [],
      TOKEN_PROGRAM_ID
    )
  );
  tx.feePayer = userPubkey;

  return tx;
}

export async function registerStake(
  wallet: string,
  txSignature: string,
  amount: number,
  referrer?: string
): Promise<StakeInfo> {
  const res = await fetch("/api/stake", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet, txSignature, amount, referrer }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Failed to register stake");
  }
  return {
    id: data.stakeId,
    wallet: data.wallet,
    amount: Number(data.amount),
    tierBps: data.tierBps,
    tierLabel: data.tierLabel,
    startTime: data.startTime,
    unlockTime: data.unlockTime,
    totalReward: Number(data.totalReward),
    rewardDistributed: 0,
    accrued: 0,
    status: data.status,
    childWallet: data.childWallet,
    depositTxSig: txSignature,
    claimTxSig: null,
  };
}

export interface ReferralInfo {
  balance: number;
  totalEarned: number;
  referralCode: string;
  referrals: { wallet: string; joinedAt: string }[];
  recentAccruals: {
    amount: number;
    level: number;
    sourceWallet: string;
    createdAt: string;
  }[];
}

export interface ClaimResult {
  claimed: number;
  claimedUsd: string;
  txSignature: string;
}

export async function fetchReferralData(
  wallet: string
): Promise<ReferralInfo> {
  const res = await fetch(`/api/referral/${wallet}`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Failed to fetch referral data");
  }
  return {
    balance: Number(data.balance),
    totalEarned: Number(data.totalEarned),
    referralCode: data.referralCode,
    referrals: data.referrals,
    recentAccruals: data.recentAccruals.map(
      (a: { amount: string; level: number; sourceWallet: string; createdAt: string }) => ({
        ...a,
        amount: Number(a.amount),
      })
    ),
  };
}

export async function claimReferral(
  wallet: string
): Promise<ClaimResult> {
  const res = await fetch("/api/referral/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Failed to claim referral rewards");
  }
  return {
    claimed: Number(data.claimed),
    claimedUsd: data.claimedUsd,
    txSignature: data.txSignature,
  };
}

export async function fetchStakeFromApi(
  wallet: string
): Promise<{ stake: StakeInfo | null; pool: PoolInfo | null }> {
  const res = await fetch(`/api/stake/${wallet}`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Failed to fetch stake");
  }
  const s = data.stake;
  const p = data.pool;
  return {
    stake: s
      ? {
          id: s.id,
          wallet: s.wallet,
          amount: Number(s.amount),
          tierBps: s.tierBps,
          tierLabel: s.tierLabel,
          startTime: s.startTime,
          unlockTime: s.unlockTime,
          totalReward: Number(s.totalReward),
          rewardDistributed: Number(s.rewardDistributed),
          accrued: s.accrued,
          status: s.status,
          childWallet: s.childWallet,
          depositTxSig: s.depositTxSig,
          claimTxSig: s.claimTxSig,
        }
      : null,
    pool: p
      ? {
          totalStaked: Number(p.totalStaked),
          capTotalStaked: Number(p.capTotalStaked),
          rewardPoolMax: Number(p.rewardPoolMax),
          rewardPoolReserved: Number(p.rewardPoolReserved),
        }
      : null,
  };
}

export function buildSolTransferTx(
  userPubkey: PublicKey,
  solAmount: number
): Transaction {
  const mainWallet = getMainWallet();
  const lamports = Math.round(solAmount * LAMPORTS_PER_SOL);

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: userPubkey,
      toPubkey: mainWallet,
      lamports,
    })
  );
  tx.feePayer = userPubkey;
  return tx;
}

export async function registerStakeFromSol(
  wallet: string,
  solTxSignature: string,
  referrer?: string
): Promise<StakeInfo> {
  const res = await fetch("/api/stake-sol", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet, txSignature: solTxSignature, referrer }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Failed to register SOL stake");
  }
  return {
    id: data.stakeId,
    wallet: data.wallet,
    amount: Number(data.amount),
    tierBps: data.tierBps,
    tierLabel: data.tierLabel,
    startTime: data.startTime,
    unlockTime: data.unlockTime,
    totalReward: Number(data.totalReward),
    rewardDistributed: 0,
    accrued: 0,
    status: data.status,
    childWallet: data.childWallet,
    depositTxSig: solTxSignature,
    claimTxSig: null,
  };
}

export async function withdrawStake(
  stakeId: string,
  wallet: string,
  destinationWallet?: string
): Promise<{ txSignature: string; amount: string; totalReward: string }> {
  const res = await fetch("/api/stake/withdraw", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stakeId, wallet, destinationWallet }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Failed to withdraw");
  }
  return {
    txSignature: data.txSignature,
    amount: data.amount,
    totalReward: data.totalReward,
  };
}

export async function restakeStake(
  stakeId: string,
  wallet: string
): Promise<{ newStakeId: string; amount: string; unlockTime: number; tierLabel: string }> {
  const res = await fetch("/api/stake/restake", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stakeId, wallet }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Failed to restake");
  }
  return {
    newStakeId: data.newStakeId,
    amount: data.amount,
    unlockTime: data.unlockTime,
    tierLabel: data.tierLabel,
  };
}
