import { describe, expect, it } from "vitest";
import { commandEnvironment, isAllowedCollectReportPath, parseCollectCliArgs } from "../scripts/collect";
import { selectComponentTarget, selectDevelopmentCollectorCliTarget } from "../src/server/config/targets";

describe("collector CLI safety boundary", () => {
  it("requires an explicit environment and mode and guards production writes", () => {
    expect(() => parseCollectCliArgs([])).toThrow("collect_cli_invalid_arguments");
    expect(parseCollectCliArgs(["--env", "development", "--dry-run"])).toMatchObject({
      environment: "development",
      mode: "dry-run",
      allowProduction: false,
    });
    expect(() => parseCollectCliArgs(["--env", "production", "--apply"])).toThrow("collect_production_guard_required");
    expect(parseCollectCliArgs(["--env", "production", "--apply", "--allow-production"]).allowProduction).toBe(true);
  });

  it("allows reports only in a run artifact directory or the runner temp directory", () => {
    const cwd = "/workspace/pkgcompass";
    expect(isAllowedCollectReportPath("artifacts/runs/run-1/report.json", { cwd })).toBe(true);
    expect(isAllowedCollectReportPath("artifacts/runs/../report.json", { cwd })).toBe(false);
    expect(isAllowedCollectReportPath("/workspace/out/report.json", { cwd })).toBe(false);
    expect(isAllowedCollectReportPath("/runner-temp/report.json", { cwd, runnerTemp: "/runner-temp" })).toBe(true);
    expect(isAllowedCollectReportPath("/runner-temp/../report.json", { cwd, runnerTemp: "/runner-temp" })).toBe(false);
  });

  it("allows only a manually dispatched GitHub Actions runner to select the explicit live target", () => {
    const args = parseCollectCliArgs(["--env", "development", "--apply"]);
    const githubRunner = commandEnvironment(args, {
      APP_ENV: "development",
      CI: "true",
      GITHUB_ACTIONS: "true",
      GITHUB_EVENT_NAME: "workflow_dispatch",
    });
    const targetSource = {
      ...githubRunner,
      DATABASE_IMPORT_URL: "postgresql://pkgcompass_metrics_writer:pass@ep.example.neon.tech/pkgcompass?sslmode=require",
      IMPORT_INVALIDATION_SECRET: "i".repeat(40),
      SANITY_PROJECT_ID: "pkgcompass9",
      SANITY_DATASET: "development",
      SANITY_API_VERSION: "2026-10-01",
    };

    expect(githubRunner.CI).toBe("true");
    expect(selectComponentTarget("metricsWriter", targetSource)).toMatchObject({ mode: "fixture", environment: "fixture" });
    expect(selectDevelopmentCollectorCliTarget("metricsWriter", targetSource)).toMatchObject({ mode: "live", environment: "development" });
    expect(selectDevelopmentCollectorCliTarget("content", targetSource)).toMatchObject({ mode: "live", environment: "development" });
    expect(selectDevelopmentCollectorCliTarget("importInvalidation", targetSource)).toMatchObject({ mode: "live", environment: "development" });
    expect(() => commandEnvironment(args, {
      APP_ENV: "development",
      CI: "true",
      GITHUB_ACTIONS: "true",
      GITHUB_EVENT_NAME: "pull_request",
    })).toThrow("collect_untrusted_context");
    expect(() => commandEnvironment(args, {
      APP_ENV: "development",
      CI: "true",
      GITHUB_ACTIONS: "true",
      GITHUB_EVENT_NAME: "push",
    })).toThrow("collect_untrusted_context");
  });

  it("does not impersonate Vercel to enable production from GitHub Actions", () => {
    const source = {
      APP_ENV: "production",
      CI: "true",
      GITHUB_ACTIONS: "true",
      GITHUB_EVENT_NAME: "workflow_dispatch",
    };
    const args = parseCollectCliArgs(["--env", "production", "--apply", "--allow-production"]);
    expect(() => commandEnvironment(args, source)).toThrow("collect_production_workflow_unavailable");
    expect(source).not.toHaveProperty("VERCEL");
  });
});
