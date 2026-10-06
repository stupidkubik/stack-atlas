import { describe, expect, it } from "vitest";
import { selectComponentTarget } from "../src/server/config/targets";
import { publicRuntimeConfig } from "../src/server/config/public";

describe("development consumer configuration", () => {
  it("keeps future consumer secrets out of fixture and public projections", () => {
    const source = { APP_ENV: "fixture", LEAD_HMAC_SECRET: "private-sentinel", PREVIEW_SESSION_SECRET: "private-sentinel" };
    expect(selectComponentTarget("preview", source)).toEqual({ mode: "fixture", environment: "fixture", component: "preview" });
    expect(JSON.stringify(publicRuntimeConfig(source))).not.toContain("private-sentinel");
  });

  it("requires strong single-line generated secrets and validates the form origin", () => {
    const valid = { APP_ENV: "development", LEAD_HMAC_SECRET: "synthetic-testing-secret-32-characters", SITE_URL: "http://127.0.0.1:3000" };
    expect(selectComponentTarget("leadSecurity", valid)).toMatchObject({ mode: "live", environment: "development" });
    for (const value of ["short", "synthetic-testing-secret-32-characters\nunsafe"]) {
      expect(() => selectComponentTarget("leadSecurity", { ...valid, LEAD_HMAC_SECRET: value })).toThrow("LEAD_HMAC_SECRET");
    }
    for (const origin of ["http://example.invalid", "https://example.invalid/en/", "https://user:password@example.invalid", "https://example.invalid?query=1"]) {
      expect(() => selectComponentTarget("leadSecurity", { ...valid, SITE_URL: origin })).toThrow("SITE_URL");
    }
  });

  it("selects each credential independently and does not require an unrelated writer", () => {
    const source = { APP_ENV: "development", SANITY_WEBHOOK_SECRET: "synthetic-webhook-secret-32-characters" };
    expect(selectComponentTarget("webhook", source)).toMatchObject({ component: "webhook", mode: "live" });
    expect(() => selectComponentTarget("seed", source)).toThrow("SANITY_SEED_WRITE_TOKEN");
    expect(() => selectComponentTarget("daily", source)).toThrow("CRON_SECRET");
  });

  it("rejects an unsafe dispatch target instead of taking repository or ref from HTTP input", () => {
    const source = { APP_ENV: "development", CRON_SECRET: "synthetic-cron-secret-32-characters", GITHUB_DISPATCH_TOKEN: "synthetic-provider-token", GITHUB_ACTIONS_REPOSITORY: "example/project", GITHUB_ACTIONS_REF: "work/foundation-first-pass" };
    expect(selectComponentTarget("daily", source)).toMatchObject({ mode: "live", component: "daily" });
    for (const ref of ["../main", "main..other", "work//main", "main.lock", "main?credential=secret"]) {
      expect(() => selectComponentTarget("daily", { ...source, GITHUB_ACTIONS_REF: ref })).toThrow("GITHUB_ACTIONS_REF");
    }
    expect(() => selectComponentTarget("daily", { ...source, GITHUB_ACTIONS_REPOSITORY: "https://example.invalid/repo" })).toThrow("GITHUB_ACTIONS_REPOSITORY");
  });
});
