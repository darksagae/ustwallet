"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

function UnsubscribeContent() {
  const params = useSearchParams();
  const success = params.get("success");
  const error = params.get("error");

  return (
    <div className="max-w-md w-full bg-slate-900/60 border border-slate-800 rounded-2xl p-8 text-center">
      {success === "1" ? (
        <>
          <h1 className="text-xl font-bold text-emerald-400 mb-2">
            You&apos;re unsubscribed
          </h1>
          <p className="text-slate-400 text-sm mb-6">
            You will no longer receive reward notifications from UST Wallet.
          </p>
        </>
      ) : error ? (
        <>
          <h1 className="text-xl font-bold text-amber-400 mb-2">
            Unable to unsubscribe
          </h1>
          <p className="text-slate-400 text-sm mb-6">
            {error === "missing" && "No unsubscribe token was provided."}
            {error === "invalid" && "This link is invalid or already used."}
            {error === "server" &&
              "Something went wrong. Please try again later."}
          </p>
        </>
      ) : (
        <>
          <h1 className="text-xl font-bold text-slate-300 mb-2">
            Unsubscribe
          </h1>
          <p className="text-slate-400 text-sm mb-6">
            Use the link from your email to unsubscribe from notifications.
          </p>
        </>
      )}
      <Link
        href="/"
        className="inline-block px-6 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-medium transition-colors"
      >
        Back to UST Wallet
      </Link>
    </div>
  );
}

export default function UnsubscribePage() {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <Suspense
        fallback={
          <div className="text-slate-400 text-sm">Loading...</div>
        }
      >
        <UnsubscribeContent />
      </Suspense>
    </div>
  );
}
