import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  trailingSlash: true,
  // Preview handshakes may contain an ephemeral operation credential in the URL.
  logging: { incomingRequests: false, fetches: { fullUrl: false } },
};

export default nextConfig;
