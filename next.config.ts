import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  // The browser smoke uses this exact loopback host; Next dev validates HMR origins.
  allowedDevOrigins: ["127.0.0.1"],
  trailingSlash: true,
  // Preview handshakes may contain an ephemeral operation credential in the URL.
  logging: { incomingRequests: false, fetches: { fullUrl: false } },
};

export default nextConfig;
