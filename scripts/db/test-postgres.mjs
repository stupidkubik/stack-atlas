import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { SafeDatabaseCliError, validatePostgresUrl } from "./cli.mjs";

const connectionString = process.env.DATABASE_TEST_URL;
try {
  const safeUrl = validatePostgresUrl(connectionString, "DATABASE_TEST_URL");
  const target = new URL(safeUrl);
  const host = target.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    !["localhost", "127.0.0.1", "::1"].includes(host) ||
    target.pathname !== "/pkgcompass_fp03_review"
  ) {
    throw new SafeDatabaseCliError("db_test_target_must_be_isolated_loopback");
  }
} catch {
  console.error("PostgreSQL integration test requires DATABASE_TEST_URL for the isolated loopback test database.");
  process.exit(1);
}

const vitestEntry = resolve("node_modules/vitest/vitest.mjs");
const result = spawnSync(
  process.execPath,
  [vitestEntry, "run", "tests/foundation-db-independent.test.ts"],
  { cwd: process.cwd(), env: process.env, stdio: "inherit" },
);
if (result.error || result.status === null) {
  console.error("PostgreSQL integration test runner failed to start.");
  process.exit(1);
}
process.exit(result.status);
