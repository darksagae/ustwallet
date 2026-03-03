import { Raydium } from "@raydium-io/raydium-sdk-v2";
import { NATIVE_MINT } from "@solana/spl-token";
import BN from "bn.js";
import { UST_MINT, RPC_URL, RAYDIUM_SOL_UST_POOL_ID } from "./constants";
import { getConnection, loadMainWallet } from "./custody";

let raydiumInstance: Raydium | null = null;

async function getRaydium(): Promise<Raydium> {
  if (raydiumInstance) return raydiumInstance;
  const connection = getConnection();
  const owner = loadMainWallet();
  raydiumInstance = await Raydium.load({
    connection,
    owner,
    disableLoadToken: true,
  });
  return raydiumInstance;
}

export interface SwapResult {
  txId: string;
  ustAmountRaw: bigint;
}

/**
 * Swap SOL (in lamports) to UST via the Raydium AMM pool.
 * Returns the tx signature and the raw UST amount received.
 */
export async function swapSolToUst(
  solLamports: bigint,
  slippage = 0.01
): Promise<SwapResult> {
  if (!RAYDIUM_SOL_UST_POOL_ID) {
    throw new Error("NEXT_PUBLIC_RAYDIUM_SOL_UST_POOL_ID is not configured");
  }

  const raydium = await getRaydium();

  const { poolInfo, poolKeys, poolRpcData } =
    await raydium.liquidity.getPoolInfoFromRpc({
      poolId: RAYDIUM_SOL_UST_POOL_ID,
    });

  const poolMintA = poolInfo.mintA?.address ?? "";
  const poolMintB = poolInfo.mintB?.address ?? "";
  const solMint = NATIVE_MINT.toBase58();
  const ustMint = UST_MINT.toBase58();
  const poolHasSol =
    poolMintA === solMint || poolMintB === solMint;
  const poolHasUst =
    poolMintA === ustMint || poolMintB === ustMint;
  if (!poolHasSol || !poolHasUst) {
    throw new Error(
      `Pool token mismatch. This pool has mints: ${poolMintA}, ${poolMintB}. ` +
        `Expected SOL (${solMint}) and UST (${ustMint}). ` +
        `Set NEXT_PUBLIC_RAYDIUM_SOL_UST_POOL_ID to a pool that trades SOL for your UST mint, or set NEXT_PUBLIC_UST_MINT to match this pool.`
    );
  }

  const amountIn = new BN(solLamports.toString());

  const out = raydium.liquidity.computeAmountOut({
    poolInfo: {
      ...poolInfo,
      baseReserve: poolRpcData.baseReserve,
      quoteReserve: poolRpcData.quoteReserve,
      status: poolRpcData.status.toNumber(),
      version: 4,
    },
    amountIn,
    mintIn: NATIVE_MINT.toBase58(),
    mintOut: UST_MINT.toBase58(),
    slippage,
  });

  const { execute } = await raydium.liquidity.swap({
    poolInfo,
    poolKeys,
    amountIn,
    amountOut: out.minAmountOut,
    inputMint: NATIVE_MINT.toBase58(),
    fixedSide: "in",
    config: {
      inputUseSolBalance: true,
      outputUseSolBalance: false,
    },
    computeBudgetConfig: {
      units: 600_000,
      microLamports: 50_000,
    },
  });

  const { txId } = await execute({ sendAndConfirm: true });

  return {
    txId,
    ustAmountRaw: BigInt(out.amountOut.toString()),
  };
}

/**
 * Get a quote: estimated UST for a given SOL amount (lamports).
 * Does not execute a swap.
 */
export async function quoteSwap(
  solLamports: bigint,
  slippage = 0.01
): Promise<{
  estimatedUst: bigint;
  minUst: bigint;
  priceImpact: string;
}> {
  if (!RAYDIUM_SOL_UST_POOL_ID) {
    throw new Error("NEXT_PUBLIC_RAYDIUM_SOL_UST_POOL_ID is not configured");
  }

  const raydium = await getRaydium();

  const { poolInfo, poolRpcData } =
    await raydium.liquidity.getPoolInfoFromRpc({
      poolId: RAYDIUM_SOL_UST_POOL_ID,
    });

  const poolMintA = poolInfo.mintA?.address ?? "";
  const poolMintB = poolInfo.mintB?.address ?? "";
  const solMint = NATIVE_MINT.toBase58();
  const ustMint = UST_MINT.toBase58();
  const poolHasSol = poolMintA === solMint || poolMintB === solMint;
  const poolHasUst = poolMintA === ustMint || poolMintB === ustMint;
  if (!poolHasSol || !poolHasUst) {
    throw new Error(
      `Pool token mismatch. This pool has mints: ${poolMintA}, ${poolMintB}. ` +
        `Expected SOL (${solMint}) and UST (${ustMint}).`
    );
  }

  const amountIn = new BN(solLamports.toString());

  const out = raydium.liquidity.computeAmountOut({
    poolInfo: {
      ...poolInfo,
      baseReserve: poolRpcData.baseReserve,
      quoteReserve: poolRpcData.quoteReserve,
      status: poolRpcData.status.toNumber(),
      version: 4,
    },
    amountIn,
    mintIn: NATIVE_MINT.toBase58(),
    mintOut: UST_MINT.toBase58(),
    slippage,
  });

  return {
    estimatedUst: BigInt(out.amountOut.toString()),
    minUst: BigInt(out.minAmountOut.toString()),
    priceImpact: out.priceImpact.toFixed(4),
  };
}
