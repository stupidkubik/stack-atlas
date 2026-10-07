import { describe, expect, it } from "vitest";
import {
  isDevelopmentRuntimeAttestation,
  ownedContact,
  validateLeadApiSmokeLaunch,
  validateLeadDatabaseTarget,
  validateLeadSmokeTargetSelectors,
} from "../scripts/dev/lead-api-smoke.mjs";

describe("lead API development smoke CLI guard", () => {
  it("requires explicit development-write consent before reading ignored environment values", () => {
    expect(validateLeadApiSmokeLaunch([], {})).toBe("usage");
    expect(validateLeadApiSmokeLaunch(["--env=production", "--allow-development-writes"], {})).toBe("usage");
    expect(validateLeadApiSmokeLaunch(["--env=development", "--allow-development-writes"], { APP_ENV: "production" })).toBe("environment_mismatch");
  });

  it.each([
    { CI: "true" },
    { CI: "1" },
    { GITHUB_EVENT_NAME: "pull_request" },
    { PKGCOMPASS_UNTRUSTED_PR: "true" },
    { VERCEL_GIT_PULL_REQUEST_ID: "synthetic" },
  ])("rejects untrusted execution contexts", (env) => {
    expect(validateLeadApiSmokeLaunch(["--env=development", "--allow-development-writes"], env)).toBe(
      "untrusted_execution_context",
    );
  });

  it("allows cleanup only for the exact created contact and sole development list", () => {
    const owned = {
      id: 37,
      email: "synthetic-owner-alias",
      createdAt: "2026-10-06T12:00:00.000Z",
      listIds: [73],
    };
    const identity = { id: 37, email: "synthetic-owner-alias", listId: 73, createdAt: owned.createdAt };
    expect(ownedContact(owned, identity)).toBe(true);
    expect(ownedContact({ ...owned, id: 38 }, identity)).toBe(false);
    expect(ownedContact({ ...owned, createdAt: "2026-10-06T12:01:00.000Z" }, identity)).toBe(false);
    expect(ownedContact({ ...owned, listIds: [73, 74] }, identity)).toBe(false);
  });

  it("requires the lead-writer pooled TLS URL and any available role URLs to share the dev endpoint", () => {
    const lead = "postgresql://pkgcompass_lead_writer:synthetic-password@ep-dev-pooler.region.aws.neon.tech/pkgcompass_dev?sslmode=require";
    const read = "postgresql://pkgcompass_public_reader:synthetic-password@ep-dev-pooler.region.aws.neon.tech/pkgcompass_dev?sslmode=require";
    expect(validateLeadDatabaseTarget({ DATABASE_LEAD_URL: lead, DATABASE_READ_URL: read })).toBeNull();
    expect(validateLeadDatabaseTarget({
      DATABASE_LEAD_URL: "postgresql://pkgcompass_lead_writer:synthetic-password@ep-dev.region.aws.neon.tech/pkgcompass_dev?sslmode=require",
    })).toBe("lead_database_target_invalid");
    expect(validateLeadDatabaseTarget({
      DATABASE_LEAD_URL: lead,
      DATABASE_READ_URL: "postgresql://pkgcompass_public_reader:synthetic-password@ep-other-pooler.region.aws.neon.tech/pkgcompass_dev?sslmode=require",
    })).toBe("database_target_mismatch");
  });

  it("uses only an explicit process loopback target and permits a remote ignored default to remain unused", () => {
    expect(validateLeadSmokeTargetSelectors(
      { APP_ENV: "development", SITE_URL: "http://127.0.0.1:3000" },
      { APP_ENV: "", SITE_URL: "https://configured.example.invalid" },
    )).toEqual({ origin: "http://127.0.0.1:3000" });
    expect(validateLeadSmokeTargetSelectors(
      { APP_ENV: "development", SITE_URL: "https://configured.example.invalid" },
      {},
    )).toEqual({ code: "site_origin_not_loopback" });
    expect(validateLeadSmokeTargetSelectors(
      { APP_ENV: "development" },
      {},
    )).toEqual({ code: "site_origin_not_loopback" });
    expect(validateLeadSmokeTargetSelectors(
      { APP_ENV: "production", SITE_URL: "http://127.0.0.1:3000" },
      {},
    )).toEqual({ code: "app_env_not_development" });
  });

  it("accepts only a consistent development runtime attestation", () => {
    expect(isDevelopmentRuntimeAttestation(200, { available: true, environment: "development" })).toBe(true);
    expect(isDevelopmentRuntimeAttestation(503, { available: false, environment: "development" })).toBe(true);
    expect(isDevelopmentRuntimeAttestation(200, { available: true, environment: "production" })).toBe(false);
    expect(isDevelopmentRuntimeAttestation(200, { available: false, environment: "development" })).toBe(false);
  });
});
