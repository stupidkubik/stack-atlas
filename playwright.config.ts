import { defineConfig, devices } from "@playwright/test";

const runId = process.env.PKGCOMPASS_RUN_ID;

if (!runId || !/^\d{8}T\d{6}Z-[A-Za-z0-9-]+$/.test(runId)) {
  throw new Error(
    "Set PKGCOMPASS_RUN_ID to an active worklog run ID before invoking Playwright.",
  );
}

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: `artifacts/runs/${runId}/evidence/playwright`,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
  },
});
