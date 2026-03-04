"use client";

import { useMemo, ReactNode, useState, useCallback, useEffect } from "react";
import {
  ConnectionProvider,
  WalletProvider as SolanaWalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { WalletConnectWalletAdapter } from "@solana/wallet-adapter-walletconnect";
import type { WalletAdapter } from "@solana/wallet-adapter-base";
import type { WalletError } from "@solana/wallet-adapter-base";
import {
  RPC_URL,
  WALLETCONNECT_PROJECT_ID,
  APP_URL,
} from "@/lib/constants";

import "@solana/wallet-adapter-react-ui/styles.css";

const SOLANA_NETWORK =
  process.env.NEXT_PUBLIC_SOLANA_NETWORK === "devnet"
    ? WalletAdapterNetwork.Devnet
    : WalletAdapterNetwork.Mainnet;

const PROPOSAL_EXPIRED_MSG =
  "Connection request expired. Please try again and approve in your wallet within a few minutes.";

function isProposalExpiredError(error: unknown): boolean {
  const msg =
    error instanceof Error
      ? error.message
      : error != null
        ? String(error)
        : "";
  return /proposal\s*expired/i.test(msg);
}

export default function WalletProvider({ children }: { children: ReactNode }) {
  const [walletErrorDisplay, setWalletErrorDisplay] = useState<string | null>(
    null
  );

  const handleWalletError = useCallback((error: WalletError, _adapter?: WalletAdapter) => {
    if (isProposalExpiredError(error)) {
      setWalletErrorDisplay(PROPOSAL_EXPIRED_MSG);
      return;
    }
    console.error("[Wallet]", error, _adapter);
  }, []);

  useEffect(() => {
    function onUnhandledRejection(ev: PromiseRejectionEvent) {
      if (!isProposalExpiredError(ev.reason)) return;
      ev.preventDefault();
      ev.stopPropagation();
      setWalletErrorDisplay(PROPOSAL_EXPIRED_MSG);
    }
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () =>
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
  }, []);

  const wallets = useMemo((): WalletAdapter[] => {
    const list: WalletAdapter[] = [new PhantomWalletAdapter()];
    if (WALLETCONNECT_PROJECT_ID) {
      const baseUrl =
        typeof window !== "undefined" ? window.location.origin : APP_URL;
      list.push(
        new WalletConnectWalletAdapter({
          network: SOLANA_NETWORK,
          options: {
            projectId: WALLETCONNECT_PROJECT_ID,
            relayUrl: "wss://relay.walletconnect.com",
            metadata: {
              name: "UST Wallet",
              description:
                "90-day UST staking — earn 1% daily. Stake with SOL or UST.",
              url: baseUrl,
              icons: [`${baseUrl}/favicon.ico`],
            },
          },
        })
      );
    }
    return list;
  }, []);

  return (
    <ConnectionProvider endpoint={RPC_URL}>
      <SolanaWalletProvider
        wallets={wallets}
        autoConnect
        onError={handleWalletError}
      >
        <WalletModalProvider>
          {walletErrorDisplay && (
            <div
              role="alert"
              className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] max-w-md px-4 py-3 rounded-lg bg-amber-500/95 text-black text-sm font-medium shadow-lg flex items-center justify-between gap-4"
            >
              <span>{walletErrorDisplay}</span>
              <button
                type="button"
                onClick={() => setWalletErrorDisplay(null)}
                className="shrink-0 px-2 py-1 rounded bg-black/20 hover:bg-black/30 font-medium"
              >
                Dismiss
              </button>
            </div>
          )}
          {children}
        </WalletModalProvider>
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
}
