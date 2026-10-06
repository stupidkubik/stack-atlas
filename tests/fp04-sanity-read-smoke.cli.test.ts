import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../scripts/dev/sanity-read-smoke.mjs", import.meta.url));

function invoke(args: readonly string[], env: Readonly<Record<string, string | undefined>>) {
  return spawnSync(process.execPath, [script, ...args], {
    env: { ...env, NODE_ENV: "test" },
    encoding: "utf8",
    timeout: 5_000,
  });
}

describe("Sanity live smoke CLI preflight", () => {
  it("requires the explicit development environment before loading credentials", () => {
    const result = invoke([], {});
    expect(result.status).toBe(2);
    expect(result.stdout.trim()).toBe("Usage: sanity-read-smoke --env development");
    expect(result.stderr).toBe("");
  });

  it("rejects production before loading credentials or making requests", () => {
    const result = invoke(["--env", "development"], { APP_ENV: "production" });
    expect(result.status).toBe(1);
    expect(result.stdout.trim()).toBe(
      "sanity_read_smoke target=fail mapping=not_run code=environment_mismatch",
    );
    expect(result.stderr).toBe("");
  });

  it("rejects untrusted CI before loading credentials or making requests", () => {
    const result = invoke(["--env", "development"], { CI: "true" });
    expect(result.status).toBe(1);
    expect(result.stdout.trim()).toBe(
      "sanity_read_smoke target=fail mapping=not_run code=untrusted_environment",
    );
    expect(result.stderr).toBe("");
  });

  it("passes only synthetic Sanity read settings to the Vitest child", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pkgcompass-sanity-cli-review-"));
    try {
      mkdirSync(join(cwd, "node_modules", "vitest"), { recursive: true });
      writeFileSync(join(cwd, ".env.local"), [
        "APP_ENV=development",
        "SANITY_PROJECT_ID=synthetic-project9",
        "SANITY_DATASET=development",
        "SANITY_API_VERSION=2026-10-05",
        "SANITY_STUDIO_PROJECT_ID=synthetic-project9",
        "SANITY_STUDIO_DATASET=development",
        "SANITY_PREVIEW_READ_TOKEN=synthetic-preview-token",
        "DATABASE_READ_URL=synthetic-database-secret",
        "DATABASE_IMPORT_URL=synthetic-import-secret",
        "DATABASE_LEAD_URL=synthetic-lead-secret",
        "DATABASE_MIGRATION_URL=synthetic-migration-secret",
        "BREVO_API_KEY=synthetic-crm-secret",
        "SANITY_SEED_WRITE_TOKEN=synthetic-write-secret",
        "SANITY_WEBHOOK_SECRET=synthetic-webhook-secret",
        "GITHUB_DISPATCH_TOKEN=synthetic-dispatch-secret",
        "CRON_SECRET=synthetic-cron-secret",
        "NEXT_PUBLIC_POSTHOG_KEY=synthetic-posthog-project-key",
        "UNRELATED_SENTINEL=synthetic-unrelated-secret",
      ].join("\n") + "\n");
      writeFileSync(join(cwd, "node_modules", "vitest", "vitest.mjs"), [
        "const allowed = [",
        "  process.env.NODE_ENV === 'test',",
        "  process.env.APP_ENV === 'development',",
        "  process.env.PKGCOMPASS_SANITY_READ_SMOKE === 'development',",
        "  process.env.SANITY_PROJECT_ID === 'synthetic-project9',",
        "  process.env.SANITY_DATASET === 'development',",
        "  process.env.SANITY_API_VERSION === '2026-10-05',",
        "  process.env.SANITY_STUDIO_PROJECT_ID === 'synthetic-project9',",
        "  process.env.SANITY_STUDIO_DATASET === 'development',",
        "  process.env.SANITY_PREVIEW_READ_TOKEN === 'synthetic-preview-token',",
      ].join("\n") + "];\n" + [
        "const blocked = [",
        "  'DATABASE_READ_URL', 'DATABASE_IMPORT_URL', 'DATABASE_LEAD_URL',",
        "  'DATABASE_MIGRATION_URL', 'BREVO_API_KEY', 'SANITY_SEED_WRITE_TOKEN',",
        "  'SANITY_WEBHOOK_SECRET', 'GITHUB_DISPATCH_TOKEN', 'CRON_SECRET',",
        "  'NEXT_PUBLIC_POSTHOG_KEY', 'UNRELATED_SENTINEL',",
        "].every((name) => process.env[name] === undefined);",
        "const passed = allowed.every(Boolean) && blocked;",
        "process.stdout.write(`child_env_allowlist=${passed ? 'pass' : 'fail'}\\n`);",
        "if (!passed) process.exitCode = 9;",
      ].join("\n"));

      const result = spawnSync(process.execPath, [script, "--env", "development"], {
        cwd,
        env: { PATH: process.env.PATH ?? "", NODE_ENV: "development" },
        encoding: "utf8",
        timeout: 5_000,
      });
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe("child_env_allowlist=pass");
      expect(result.stderr).toBe("");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
