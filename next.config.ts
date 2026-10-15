import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
