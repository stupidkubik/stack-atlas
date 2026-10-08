import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { catalogPreflightRequest } from "../src/server/config/origins";

vi.mock("../src/server/config/environment", async () => {
  const actual = await vi.importActual<typeof import("../src/server/config/environment")>("../src/server/config/environment");
  return { ...actual, resolveAppEnvironment: () => "development" };
});
import { proxy } from "../src/proxy";

const origin = "https://trusted-preview.vercel.app";
const syntheticOidc = "synthetic.oidc.fixture";
const syntheticCookie = "synthetic.sso.fixture";
function incoming(host = "trusted-preview.vercel.app") {
  return new Headers({
    host,
    "x-vercel-trusted-oidc-idp-token": syntheticOidc,
    cookie: `app_session=synthetic-app; _vercel_jwt=${syntheticCookie}; pkgcompass_preview=synthetic-preview; ph_cookie=synthetic-analytics`,
    authorization: "Bearer synthetic-app-auth",
    "x-vercel-protection-bypass": "synthetic-other-credential",
    "x-vercel-oidc-token": "synthetic-workload-identity",
    "x-forwarded-for": "synthetic-network-metadata",
    "x-forwarded-host": "attacker.invalid",
    referer: "https://attacker.invalid/?private=synthetic",
  });
}

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("protected catalog self-preflight", () => {
  it("forwards only the accepted deployment protection carriers to the configured host", () => {
    const preflight = catalogPreflightRequest([origin], incoming());
    expect(preflight?.url.href).toBe(`${origin}/api/catalog-status/`);
    expect(Object.fromEntries(preflight!.headers)).toEqual({
      cookie: `_vercel_jwt=${syntheticCookie}`,
      "x-vercel-trusted-oidc-idp-token": syntheticOidc,
    });
  });

  it("allows normal public requests without inventing deployment credentials", () => {
    const preflight = catalogPreflightRequest([origin], new Headers({ host: "trusted-preview.vercel.app", cookie: "app_session=synthetic" }));
    expect(Object.fromEntries(preflight!.headers)).toEqual({});
  });

  it("does not forward protection carriers to an arbitrary host, port, or injected authority", () => {
    for (const host of ["attacker.invalid", "trusted-preview.vercel.app:444", "trusted-preview.vercel.app@attacker.invalid", "trusted-preview.vercel.app/path"]) {
      expect(catalogPreflightRequest([origin], incoming(host))).toBeUndefined();
    }
    const headers = incoming();
    headers.delete("host");
    expect(catalogPreflightRequest([origin], headers)).toBeUndefined();
  });

  it("uses deployment identity when incoming protection was consumed, only for that exact configured deployment", () => {
    const headers = incoming(); headers.delete("x-vercel-trusted-oidc-idp-token");
    const identity = { origin, token: "synthetic.deployment.identity" };
    expect(catalogPreflightRequest([origin], headers, identity)?.headers.get("x-vercel-trusted-oidc-idp-token")).toBe(identity.token);
    const other = "https://other-owner-domain.invalid";
    headers.set("host", "other-owner-domain.invalid");
    expect(catalogPreflightRequest([origin, other], headers, identity)?.headers.has("x-vercel-trusted-oidc-idp-token")).toBe(false);
    headers.set("host", "attacker.invalid");
    expect(catalogPreflightRequest([origin], headers, identity)).toBeUndefined();
  });

  it("preserves an inbound protection token instead of replacing it with fallback identity", () => {
    const preflight = catalogPreflightRequest([origin], incoming(), { origin, token: "synthetic.deployment.identity" });
    expect(preflight?.headers.get("x-vercel-trusted-oidc-idp-token")).toBe(syntheticOidc);
  });

  it("reauthenticates the real proxy self-fetch with renamed runtime workload identity", async () => {
    vi.stubEnv("SITE_URL", origin); vi.stubEnv("VERCEL_URL", "trusted-preview.vercel.app");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "synthetic.expired.build.identity");
    const headers = incoming(); headers.delete("x-vercel-trusted-oidc-idp-token");
    const fetcher = vi.fn().mockResolvedValue(Response.json({ available: true })); vi.stubGlobal("fetch", fetcher);
    const response = await proxy(new NextRequest(`${origin}/en/compare/a-vs-b/`, { headers }));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    const [, options] = fetcher.mock.calls[0] as [URL, RequestInit];
    expect(new Headers(options.headers).get("x-vercel-trusted-oidc-idp-token")).toBe("synthetic-workload-identity");
    expect(new Headers(options.headers).get("x-vercel-oidc-token")).toBeNull();
    expect(Object.fromEntries(new Headers(options.headers))).toEqual({ cookie: `_vercel_jwt=${syntheticCookie}`, "x-vercel-trusted-oidc-idp-token": "synthetic-workload-identity" });
  });

  it("does not use a stale build identity when no runtime identity was supplied", async () => {
    vi.stubEnv("SITE_URL", origin); vi.stubEnv("VERCEL_URL", "trusted-preview.vercel.app");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "synthetic.expired.build.identity");
    const headers = incoming(); headers.delete("x-vercel-trusted-oidc-idp-token"); headers.delete("x-vercel-oidc-token");
    const fetcher = vi.fn().mockResolvedValue(Response.json({ available: true })); vi.stubGlobal("fetch", fetcher);
    await proxy(new NextRequest(`${origin}/en/compare/a-vs-b/`, { headers }));
    const [, options] = fetcher.mock.calls[0] as [URL, RequestInit];
    expect(new Headers(options.headers).has("x-vercel-trusted-oidc-idp-token")).toBe(false);
  });

  it("does not forward duplicate, quoted, empty or prefixed Vercel cookie candidates", () => {
    for (const cookie of ["_vercel_jwt=one; _vercel_jwt=two", '_vercel_jwt="quoted"', "_vercel_jwt=", "other_vercel_jwt=synthetic", "_vercel_jwt=bad value"]) {
      const headers = incoming(); headers.set("cookie", cookie);
      expect(catalogPreflightRequest([origin], headers)?.headers.get("cookie")).toBeNull();
    }
  });

  it("uses the protection allowlist during the actual proxy fetch and blocks redirects", async () => {
    vi.stubEnv("SITE_URL", origin);
    const fetcher = vi.fn().mockResolvedValue(Response.json({ available: true }));
    vi.stubGlobal("fetch", fetcher);
    const response = await proxy(new NextRequest(`${origin}/en/compare/a-vs-b/?private=synthetic`, { headers: incoming() }));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, options] = fetcher.mock.calls[0] as [URL, RequestInit];
    expect(url.href).toBe(`${origin}/api/catalog-status/`);
    expect(options).toMatchObject({ redirect: "error", cache: "no-store" });
    expect(Object.fromEntries(new Headers(options.headers))).toEqual({ cookie: `_vercel_jwt=${syntheticCookie}`, "x-vercel-trusted-oidc-idp-token": syntheticOidc });
  });

  it("does not fetch for a forged Host even if forwarded-host names the configured deployment", async () => {
    vi.stubEnv("SITE_URL", origin);
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const headers = incoming("attacker.invalid"); headers.set("x-forwarded-host", "trusted-preview.vercel.app");
    const response = await proxy(new NextRequest(`${origin}/en/compare/a-vs-b/`, { headers }));
    expect(response.status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
