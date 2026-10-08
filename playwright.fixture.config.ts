import { defineConfig, devices } from "@playwright/test";

const runId = process.env.PKGCOMPASS_RUN_ID;
if (!runId || !/^\d{8}T\d{6}Z-[A-Za-z0-9-]+$/.test(runId)) {
  throw new Error("Set PKGCOMPASS_RUN_ID to a worklog or CI run identifier.");
}

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "fixture-lead.spec.ts",
  outputDir: `artifacts/runs/${runId}/evidence/fixture-browser`,
  reporter: "list",
  workers: 1,
  fullyParallel: false,
  preserveOutput: "never",
  timeout: 60_000,
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:4317",
    serviceWorkers: "block",
    // Request bodies and anonymous identifiers must not enter retained traces.
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: {
    command: "node scripts/test/fixture-web-server.mjs",
    url: "http://127.0.0.1:4317/api/catalog-status/",
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    timeout: 120_000,
  },
});
