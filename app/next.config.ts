import type { NextConfig } from "next";

// #region agent log
fetch("http://127.0.0.1:7461/ingest/6be44dbf-6d75-468a-9657-edaa08940de1", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Debug-Session-Id": "e39c62",
  },
  body: JSON.stringify({
    sessionId: "e39c62",
    runId: "pre-fix-1",
    hypothesisId: "A",
    location: "app/next.config.ts:4",
    message: "Next config loaded before turbopack panic",
    data: {
      nodeVersion: process.version,
      cwd: process.cwd(),
      nodeEnv: process.env.NODE_ENV,
    },
    timestamp: Date.now(),
  }),
}).catch(() => {});
// #endregion

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
