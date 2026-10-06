import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const script = resolve(process.cwd(), "scripts/dev/inventory-neon-roles.mjs");

function invoke(args: string[], env: Record<string, string>) {
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", NODE_ENV: process.env.NODE_ENV ?? "test", ...env },
  });
  return {
    status: result.status,
    output: result.stdout.trim(),
    errorOutput: result.stderr,
  };
}

describe("Neon inventory invocation guard", () => {
  it("requires an explicit development target before reading credentials", () => {
    const result = invoke([], {});
    expect(result.status).toBe(2);
    expect(JSON.parse(result.output)).toEqual({
      check: "neon_role_login",
      ok: false,
      errorCode: "development_flag_required",
    });
    expect(result.errorOutput).toBe("");
  });

  it("rejects an APP_ENV mismatch before opening connections", () => {
    const result = invoke(["--env", "development"], { APP_ENV: "production" });
    expect(result.status).toBe(2);
    expect(JSON.parse(result.output).errorCode).toBe("app_env_mismatch");
    expect(result.output).not.toContain("production");
    expect(result.errorOutput).toBe("");
  });

  it("rejects CI and untrusted pull request contexts before opening connections", () => {
    const contexts: Array<Record<string, string>> = [
      { CI: "true" },
      { GITHUB_EVENT_NAME: "pull_request" },
      { PKGCOMPASS_UNTRUSTED_PR: "true" },
      { VERCEL: "1", VERCEL_ENV: "preview" },
    ];
    for (const env of contexts) {
      const result = invoke(["--env", "development"], env);
      expect(result.status).toBe(2);
      expect(JSON.parse(result.output).errorCode).toBe("untrusted_context");
      expect(result.errorOutput).toBe("");
    }
  });
});
