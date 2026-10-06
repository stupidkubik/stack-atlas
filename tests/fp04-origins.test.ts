import { describe, expect, it } from "vitest";
import { trustedOrigins } from "../src/server/config/origins";

describe("owner-controlled deployment origins", () => {
  it("allows only the site origin in production", () => {
    expect(trustedOrigins("production", { SITE_URL: "https://example.invalid", VERCEL_URL: "preview.vercel.app" }))
      .toEqual(["https://example.invalid"]);
  });
  it("adds only configured Vercel hosts in development", () => {
    expect(trustedOrigins("development", { SITE_URL: "http://127.0.0.1:3000", VERCEL_URL: "current.vercel.app", VERCEL_BRANCH_URL: "branch.vercel.app" }))
      .toEqual(["http://127.0.0.1:3000", "https://current.vercel.app", "https://branch.vercel.app"]);
    for (const value of ["evil.invalid", "current.vercel.app/secret", "user@current.vercel.app", "https://current.vercel.app", "current..vercel.app"]) {
      expect(() => trustedOrigins("development", { SITE_URL: "https://example.invalid", VERCEL_URL: value })).toThrow("VERCEL_URL");
    }
  });
  it("rejects a missing live origin and ignores deployment URLs in fixture mode", () => {
    expect(() => trustedOrigins("development", {})).toThrow("SITE_URL");
    expect(trustedOrigins("fixture", { VERCEL_URL: "private.invalid" })).toEqual(["http://127.0.0.1:3000", "http://localhost:3000"]);
    expect(trustedOrigins("fixture", { SITE_URL: "https://production.invalid", VERCEL_URL: "preview.vercel.app" })).toEqual(["http://127.0.0.1:3000", "http://localhost:3000"]);
    expect(trustedOrigins("fixture", { SITE_URL: "not-an-origin" })).toEqual(["http://127.0.0.1:3000", "http://localhost:3000"]);
  });
});
