import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    // Baked into the bundle at build time; the client version checker compares
    // it against /api/version so open tabs refresh themselves after a deploy.
    // Vercel sets VERCEL_GIT_COMMIT_SHA automatically for git deployments.
    NEXT_PUBLIC_BUILD_VERSION: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev",
  },
  async headers() {
    return [
      {
        // The service worker script itself must never be HTTP-cached, or a
        // new worker version would only be picked up after the browser's
        // 24h service-worker update check.
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
    ];
  },
  experimental: {
    staleTimes: {
      // Tab-to-tab navigation reuses the client router cache for 3 minutes
      // instead of a full server round trip on every click. Safe here: the
      // journal's data only changes on explicit actions (IBKR sync, note /
      // trade edits), and every one of those calls router.refresh(), which
      // invalidates this cache.
      dynamic: 180,
      static: 300,
    },
  },
};

export default nextConfig;
