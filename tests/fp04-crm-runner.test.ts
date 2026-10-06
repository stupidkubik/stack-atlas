import { describe, expect, it } from "vitest";
import {
  buildBrevoSmokeChildEnvironment,
  validateBrevoLiveSmokeLaunch,
} from "../scripts/dev/brevo-runner.mjs";

describe("Brevo live smoke CLI guard", () => {
  it("requires an explicit development target before loading environment files", () => {
    expect(validateBrevoLiveSmokeLaunch([], {})).toBe("usage");
    expect(validateBrevoLiveSmokeLaunch(["--env", "production"], {})).toBe("usage");
  });

  it("rejects inherited production configuration before loading environment files", () => {
    expect(validateBrevoLiveSmokeLaunch(["--env", "development"], {
      APP_ENV: "production",
    })).toBe("environment_mismatch");
  });

  it.each([
    { CI: "true" },
    { CI: "1" },
    { GITHUB_EVENT_NAME: "pull_request" },
    { PKGCOMPASS_UNTRUSTED_PR: "true" },
    { VERCEL_GIT_PULL_REQUEST_ID: "37" },
  ])("rejects an untrusted CI/PR context before loading environment files", (env) => {
    expect(validateBrevoLiveSmokeLaunch(["--env", "development"], env)).toBe(
      "untrusted_execution_context",
    );
  });

  it("passes only required Brevo values to the opt-in child test", () => {
    const child = buildBrevoSmokeChildEnvironment({
      BREVO_API_KEY: "synthetic-key",
      BREVO_REQUEST_LIST_ID: "73",
      FP04_TEST_EMAIL: "owner.alias@example.test",
    }, {
      PATH: "/usr/bin",
      HOME: "/tmp/synthetic-home",
      DATABASE_LEAD_URL: "must-not-pass",
      SANITY_SEED_WRITE_TOKEN: "must-not-pass",
      GITHUB_DISPATCH_TOKEN: "must-not-pass",
    }, "tests/fp04-brevo-contact-live.test.ts");
    const allowedNames = [
      "APP_ENV",
      "BREVO_API_KEY",
      "BREVO_REQUEST_LIST_ID",
      "FP04_TEST_EMAIL",
      "HOME",
      "NODE_ENV",
      "PATH",
      "PKGCOMPASS_BREVO_LIVE_SMOKE",
    ].sort();
    expect(Object.keys(child).sort(), "child_environment_allowlist").toEqual(allowedNames);
    expect(child.DATABASE_LEAD_URL, "database_secret_not_forwarded").toBeUndefined();
    expect(child.SANITY_SEED_WRITE_TOKEN, "sanity_secret_not_forwarded").toBeUndefined();
    expect(child.GITHUB_DISPATCH_TOKEN, "dispatch_token_not_forwarded").toBeUndefined();
  });
});
