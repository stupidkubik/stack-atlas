import { describe, expect, it } from "vitest";
import { resolveAppEnvironment, SafeConfigurationError } from "../src/server/config/environment";
import { publicRuntimeConfig } from "../src/server/config/public";
import { selectComponentTarget } from "../src/server/config/targets";
import { safeReport, safeReportFromUnknown } from "../src/server/security/safe-report";

describe("component environment and target selection", () => {
  it("defaults local runs to fixture without inspecting NODE_ENV", () => {
    expect(resolveAppEnvironment({ NODE_ENV: "production" })).toBe("fixture");
    expect(resolveAppEnvironment({ APP_ENV: " " })).toBe("fixture");
    expect(() => resolveAppEnvironment({ APP_ENV: "production" })).toThrow("APP_ENV does not match");
  });

  it("forces untrusted pull requests to fixture even when APP_ENV says production", () => {
    const source = {
      APP_ENV: "production",
      GITHUB_EVENT_NAME: "pull_request",
      SANITY_PROJECT_ID: "secret-project",
      SANITY_DATASET: "production",
      SANITY_API_VERSION: "2026-10-01",
    };
    expect(resolveAppEnvironment(source)).toBe("fixture");
    expect(selectComponentTarget("content", source)).toEqual({
      mode: "fixture",
      environment: "fixture",
      component: "content",
    });
  });

  it("keeps trusted Vercel production builds live while local CI remains fixture", () => {
    expect(resolveAppEnvironment({ CI: "true" })).toBe("fixture");
    expect(resolveAppEnvironment({
      APP_ENV: "production",
      CI: "true",
      VERCEL: "1",
      VERCEL_ENV: "production",
    })).toBe("production");
  });

  it("requires explicit configuration in deployed contexts and rejects mismatches", () => {
    expect(() => resolveAppEnvironment({ VERCEL: "1", VERCEL_ENV: "production" }))
      .toThrowError(SafeConfigurationError);
    expect(() => resolveAppEnvironment({
      APP_ENV: "development",
      VERCEL: "1",
      VERCEL_ENV: "production",
    })).toThrow("APP_ENV does not match");
  });

  it("allows only deployment-owner marked Vercel previews to opt into a PR preview target", () => {
    const preview = {
      APP_ENV: "development",
      VERCEL: "1",
      VERCEL_ENV: "preview",
      VERCEL_GIT_PULL_REQUEST_ID: "42",
      PKGCOMPASS_TRUSTED_PREVIEW: "true",
    };
    expect(resolveAppEnvironment(preview)).toBe("development");
    expect(resolveAppEnvironment({ ...preview, GITHUB_EVENT_NAME: "pull_request" })).toBe("fixture");
    expect(resolveAppEnvironment({ ...preview, PKGCOMPASS_UNTRUSTED_PR: "true" })).toBe("fixture");
  });

  it("never repeats an invalid APP_ENV value in its error", () => {
    const sentinel = "private-app-env-sentinel";
    let error: unknown;
    try {
      resolveAppEnvironment({ APP_ENV: sentinel, VERCEL: "1", VERCEL_ENV: "production" });
    } catch (caught) {
      error = caught;
    }
    expect(String(error)).not.toContain(sentinel);
    expect((error as SafeConfigurationError).code).toBe("invalid_app_env");
  });

  it("ignores all live values in fixture mode and exports only the public measurement allowlist", () => {
    const source = {
      APP_ENV: "fixture",
      NEXT_PUBLIC_POSTHOG_KEY: "posthog-secret-sentinel",
      NEXT_PUBLIC_POSTHOG_HOST: "not a URL",
      DATABASE_IMPORT_URL: "postgres://db-secret-sentinel",
      BREVO_API_KEY: "brevo-secret-sentinel",
    };
    expect(publicRuntimeConfig(source)).toEqual({
      environment: "fixture",
      measurement: { enabled: false },
    });
    expect(JSON.stringify(publicRuntimeConfig(source))).not.toContain("sentinel");
  });

  it("validates component values with safe, component-specific failures", () => {
    const validContent = selectComponentTarget("content", {
      APP_ENV: "development",
      SANITY_PROJECT_ID: "valid-project9",
      SANITY_DATASET: "development",
      SANITY_API_VERSION: "2026-10-01",
    });
    expect(validContent).toMatchObject({ mode: "live", component: "content" });

    expect(() => selectComponentTarget("content", {
      APP_ENV: "development",
      SANITY_PROJECT_ID: "secret project value",
      SANITY_DATASET: "development",
      SANITY_API_VERSION: "2026-10-01",
    })).toThrow("SANITY_PROJECT_ID");

    expect(() => selectComponentTarget("content", {
      APP_ENV: "production",
      VERCEL: "1",
      VERCEL_ENV: "production",
      SANITY_PROJECT_ID: "valid-project9",
      SANITY_DATASET: "development",
      SANITY_API_VERSION: "2026-10-01",
    })).toThrow("SANITY_DATASET");

    expect(() => selectComponentTarget("metricsReader", {
      APP_ENV: "development",
      DATABASE_READ_URL: "not-a-database-url",
    })).toThrow("DATABASE_READ_URL");

    expect(() => selectComponentTarget("crm", {
      APP_ENV: "development",
      BREVO_API_KEY: "secret key\nwith newline",
      BREVO_REQUEST_LIST_ID: "0",
    })).toThrow("BREVO_API_KEY");

    expect(() => selectComponentTarget("measurement", {
      APP_ENV: "development",
      NEXT_PUBLIC_POSTHOG_KEY: "public-key",
      NEXT_PUBLIC_POSTHOG_HOST: "https://eu.i.posthog.com/path?x=1",
    })).toThrow("NEXT_PUBLIC_POSTHOG_HOST");
  });

  it("returns no internal settings from the public runtime config", () => {
    const config = publicRuntimeConfig({
      APP_ENV: "development",
      NEXT_PUBLIC_POSTHOG_KEY: "public-project-key",
      NEXT_PUBLIC_POSTHOG_HOST: "https://eu.i.posthog.com",
      DATABASE_READ_URL: "postgresql://reader:password@db.example.invalid/metrics",
      BREVO_API_KEY: "crm-secret-sentinel",
    });
    expect(config).toEqual({
      environment: "development",
      measurement: {
        enabled: true,
        key: "public-project-key",
        host: "https://eu.i.posthog.com",
      },
    });
    expect(JSON.stringify(config)).not.toContain("password");
    expect(JSON.stringify(config)).not.toContain("crm-secret-sentinel");
  });
});

describe("safe reports", () => {
  it("copies only enums and a runtime UUID, without reading message or cause", () => {
    const raw = "sensitive error and request data";
    const error = Object.assign(new Error(raw), {
      code: "cms_unavailable",
      cause: { message: raw, requestId: raw },
      requestId: raw,
    });
    const result = safeReportFromUnknown(error, "production", "00000000-0000-4000-8000-000000000002");
    expect(result).toEqual({
      status: 503,
      code: "cms_unavailable",
      environment: "production",
      runId: "00000000-0000-4000-8000-000000000002",
    });
    expect(JSON.stringify(result)).not.toContain(raw);
    expect(safeReportFromUnknown(error, "production", "20261005T155820Z-FP-02-test")).not.toHaveProperty("runId");
  });

  it("does not invoke a throwing code getter and clamps invalid public input", () => {
    let getterCalls = 0;
    const error = Object.defineProperty({}, "code", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("getter-secret");
      },
    });
    expect(safeReportFromUnknown(error, "not-an-environment", "bad-run-id")).toEqual({
      status: 500,
      code: "internal_error",
      environment: "fixture",
    });
    expect(getterCalls).toBe(0);
    expect(safeReport({ status: 200, code: "raw-code", environment: "production", runId: "raw-id" })).toEqual({
      status: 500,
      code: "internal_error",
      environment: "production",
    });
  });
});
