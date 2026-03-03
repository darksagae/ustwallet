"use client";

import { useState } from "react";

interface Props {
  wallet: string;
}

export default function EmailSubscribe({ wallet }: Props) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">(
    "idle"
  );
  const [message, setMessage] = useState("");

  const handleSubscribe = async () => {
    if (!email || !email.includes("@")) {
      setMessage("Enter a valid email address");
      setStatus("error");
      return;
    }
    setStatus("loading");
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, email }),
      });
      const data = await res.json();
      if (res.ok) {
        setStatus("done");
        setMessage(data.message || "Subscribed to hourly updates!");
      } else {
        setStatus("error");
        setMessage(data.error || "Subscription failed");
      }
    } catch {
      setStatus("error");
      setMessage("Network error");
    }
  };

  if (status === "done") {
    return (
      <div className="bg-slate-900/60 backdrop-blur-sm border border-emerald-800/30 rounded-2xl p-6">
        <p className="text-sm text-emerald-400">{message}</p>
      </div>
    );
  }

  return (
    <div className="bg-slate-900/60 backdrop-blur-sm border border-indigo-900/30 rounded-2xl p-6">
      <h3 className="text-sm font-semibold text-indigo-300 mb-3">
        Hourly Reward Notifications
      </h3>
      <p className="text-xs text-slate-500 mb-3">
        Get an email every hour showing your accrued rewards.
      </p>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="your@email.com"
        className="w-full px-3 py-2 bg-slate-800/80 border border-indigo-800/40 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 mb-3"
      />
      <button
        onClick={handleSubscribe}
        disabled={status === "loading"}
        className="w-full py-2 rounded-lg text-sm font-semibold bg-indigo-700 hover:bg-indigo-600 disabled:opacity-40 transition-colors"
      >
        {status === "loading" ? "Subscribing..." : "Subscribe"}
      </button>
      {status === "error" && (
        <p className="mt-2 text-xs text-red-400">{message}</p>
      )}
    </div>
  );
}
