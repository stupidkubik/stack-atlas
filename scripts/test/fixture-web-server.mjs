#!/usr/bin/env node
import { cp, mkdtemp, rm, symlink } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

// Copy only application inputs, never .env files or the caller's credentials.
// A separate .next also prevents concurrent development/build cache corruption.
const root = process.cwd();
const isolated = await mkdtemp(path.join(tmpdir(), "pkgcompass-fixture-"));
try {
  for (const input of ["src", "package.json", "tsconfig.json", "next.config.ts", "postcss.config.mjs"]) {
    await cp(path.join(root, input), path.join(isolated, input), { recursive: true });
  }
  await symlink(path.join(root, "node_modules"), path.join(isolated, "node_modules"), "dir");
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    NODE_ENV: "development",
    CI: "true",
    APP_ENV: "fixture",
    SITE_URL: "http://127.0.0.1:4317",
    NEXT_TELEMETRY_DISABLED: "1",
  };
  const child = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"),
    "dev", "--webpack", "--hostname", "127.0.0.1", "--port", "4317"], {
    cwd: isolated, env, stdio: "inherit",
  });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
    child.kill(signal);
    // Playwright terminates the process group and may escalate to SIGKILL
    // before an asynchronous finally completes. Remove our snapshot first.
    rmSync(isolated, { recursive: true, force: true });
  });
  const result = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
  process.exitCode = result;
} finally {
  await rm(isolated, { recursive: true, force: true });
}
