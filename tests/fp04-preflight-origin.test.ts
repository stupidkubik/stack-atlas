import { describe, expect, it } from "vitest";
import { catalogPreflightOrigin } from "../src/server/config/origins";

describe("catalog preflight destination", () => {
  const origins = ["http://127.0.0.1:3000", "https://trusted-preview.vercel.app"];
  it("preserves the configured loopback IP despite NextURL normalization", () => {
    expect(catalogPreflightOrigin(origins, "127.0.0.1:3000")).toBe(origins[0]);
    expect(catalogPreflightOrigin(origins, "trusted-preview.vercel.app")).toBe(origins[1]);
  });
  it("never fetches an unconfigured host, port, or injected authority", () => {
    for (const host of [null, "localhost:3000", "127.0.0.1:3001", "attacker.invalid", "trusted-preview.vercel.app@attacker.invalid", "trusted-preview.vercel.app/path"]) {
      expect(catalogPreflightOrigin(origins, host)).toBeUndefined();
    }
  });
});
