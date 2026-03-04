"use client";

import type { WalletName } from "@solana/wallet-adapter-base";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { useWallet } from "@solana/wallet-adapter-react";
import type { Wallet } from "@solana/wallet-adapter-react";
import type { MouseEvent } from "react";
import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { WalletModalContext, WalletIcon } from "@solana/wallet-adapter-react-ui";

/** Order: WalletConnect first, then Phantom (and others). */
function orderWallets(wallets: Wallet[]): Wallet[] {
  const wc = wallets.find((w) =>
    String(w.adapter.name).toLowerCase().includes("walletconnect")
  );
  const rest = wallets.filter((w) => w !== wc);
  return wc ? [wc, ...rest] : wallets;
}

/** Display name: "WalletConnect" → "Wallet Connect", others unchanged. */
function walletDisplayName(name: string): string {
  if (String(name).toLowerCase() === "walletconnect") return "Wallet Connect";
  return name;
}

function WalletListItem({
  wallet,
  onClick,
}: {
  wallet: Wallet;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <li>
      <button
        type="button"
        className="wallet-adapter-button"
        onClick={onClick}
        tabIndex={0}
      >
        <i className="wallet-adapter-button-start-icon">
          <WalletIcon wallet={wallet} />
        </i>
        {walletDisplayName(wallet.adapter.name)}
        {wallet.readyState === WalletReadyState.Installed && (
          <span> Detected</span>
        )}
      </button>
    </li>
  );
}

function CustomWalletModalInner({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { wallets, select } = useWallet();
  const orderedWallets = useMemo(() => orderWallets(wallets), [wallets]);
  const [fadeIn, setFadeIn] = useState(false);

  const handleWalletClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>, walletName: WalletName) => {
      select(walletName);
      onClose();
    },
    [select, onClose]
  );

  const handleClose = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      setFadeIn(false);
      setTimeout(onClose, 150);
    },
    [onClose]
  );

  useLayoutEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFadeIn(false);
        setTimeout(onClose, 150);
      }
    };
    setTimeout(() => setFadeIn(true), 0);
    const { overflow } = window.getComputedStyle(document.body);
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown, false);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", handleKeyDown, false);
    };
  }, [onClose]);

  const portal = typeof document !== "undefined" ? document.body : null;

  if (!portal) return null;

  return createPortal(
    <div
      aria-labelledby="wallet-adapter-modal-title"
      aria-modal="true"
      className={`wallet-adapter-modal ${fadeIn ? "wallet-adapter-modal-fade-in" : ""}`}
      ref={ref}
      role="dialog"
    >
      <div className="wallet-adapter-modal-container">
        <div className="wallet-adapter-modal-wrapper">
          <button
            type="button"
            onClick={handleClose}
            className="wallet-adapter-modal-button-close"
            aria-label="Close"
          >
            <svg width="14" height="14">
              <path d="M14 12.461 8.3 6.772l5.234-5.233L12.006 0 6.772 5.234 1.54 0 0 1.539l5.234 5.233L0 12.006l1.539 1.528L6.772 8.3l5.69 5.7L14 12.461z" />
            </svg>
          </button>
          <h1 id="wallet-adapter-modal-title" className="wallet-adapter-modal-title">
            Connect a wallet on Solana to continue
          </h1>
          <ul className="wallet-adapter-modal-list">
            {orderedWallets.map((wallet) => (
              <WalletListItem
                key={wallet.adapter.name}
                wallet={wallet}
                onClick={(e) => handleWalletClick(e, wallet.adapter.name)}
              />
            ))}
          </ul>
        </div>
      </div>
      <div
        className="wallet-adapter-modal-overlay"
        role="presentation"
        onMouseDown={handleClose}
      />
    </div>,
    portal
  );
}

export function CustomWalletModalProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <WalletModalContext.Provider value={{ visible, setVisible }}>
      {children}
      {visible && (
        <CustomWalletModalInner onClose={() => setVisible(false)} />
      )}
    </WalletModalContext.Provider>
  );
}
