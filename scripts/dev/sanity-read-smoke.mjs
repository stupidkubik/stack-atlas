#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const usage = "Usage: sanity-read-smoke --env development";
const args = process.argv.slice(2);

function isTruthy(value) {
  return value === "true" || value === "1";
}

function isUntrustedAutomation(env) {
  const hasCi = isTruthy(env.CI);
  const isPullRequest = env.GITHUB_EVENT_NAME === "pull_request" ||
    env.PKGCOMPASS_UNTRUSTED_PR === "true" ||
    Boolean(env.VERCEL_GIT_PULL_REQUEST_ID?.trim());
  return hasCi || isPullRequest || Boolean(env.VERCEL || env.VERCEL_ENV);
}

function emitFailure(code) {
  console.log(`sanity_read_smoke target=fail mapping=not_run code=${code}`);
  process.exitCode = 1;
}

if (args.length !== 2 || args[0] !== "--env" || args[1] !== "development") {
  console.log(usage);
  process.exitCode = 2;
} else if (
  process.env.APP_ENV?.trim() === "production" ||
  process.env.VERCEL_ENV === "production"
) {
  emitFailure("environment_mismatch");
} else if (isUntrustedAutomation(process.env)) {
  emitFailure("untrusted_environment");
} else {
  const require = createRequire(import.meta.url);
  const { loadEnvConfig } = require("@next/env");
  let envLoadFailed = false;
  loadEnvConfig(process.cwd(), true, {
    info() {},
    error() { envLoadFailed = true; },
  });

  if (envLoadFailed) {
    emitFailure("env_load_failed");
  } else if (isUntrustedAutomation(process.env)) {
    emitFailure("untrusted_environment");
  } else if (process.env.APP_ENV && process.env.APP_ENV.trim() !== "development") {
    emitFailure("environment_mismatch");
  } else if (!process.env.SANITY_PREVIEW_READ_TOKEN?.trim()) {
    emitFailure("missing_preview_read_token");
  } else {
    process.env.PKGCOMPASS_SANITY_READ_SMOKE = "development";
    const vitestCli = resolve(process.cwd(), "node_modules/vitest/vitest.mjs");
    const childEnv = {};
    for (const name of [
      "PATH", "HOME", "TMPDIR", "TMP", "TEMP", "SYSTEMROOT", "WINDIR", "LANG", "LC_ALL",
      "SANITY_PROJECT_ID", "SANITY_DATASET", "SANITY_API_VERSION",
      "SANITY_STUDIO_PROJECT_ID", "SANITY_STUDIO_DATASET", "SANITY_PREVIEW_READ_TOKEN",
    ]) {
      if (process.env[name] !== undefined) childEnv[name] = process.env[name];
    }
    childEnv.NODE_ENV = "test";
    childEnv.APP_ENV = "development";
    childEnv.PKGCOMPASS_SANITY_READ_SMOKE = "development";
    const child = spawnSync(process.execPath, [
      vitestCli,
      "run",
      "tests/fp04-sanity-read-smoke.live.test.ts",
      "--reporter=dot",
    ], {
      cwd: process.cwd(),
      env: childEnv,
      stdio: "inherit",
    });

    if (child.error || child.status === null) {
      emitFailure("runner_failed");
    } else {
      process.exitCode = child.status;
    }
  }
}
