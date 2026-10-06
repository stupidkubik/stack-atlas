import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

const childRuntimeNames = ["PATH", "HOME", "TMPDIR", "TEMP", "TMP"];

function emit(status, code) {
  process.stdout.write(`${JSON.stringify({ environment: "development", status, code })}\n`);
}

export function validateBrevoLiveSmokeLaunch(args, env) {
  if (args.length !== 2 || args[0] !== "--env" || args[1] !== "development") return "usage";
  if (env.APP_ENV && env.APP_ENV !== "development") return "environment_mismatch";
  if (env.CI === "true" || env.CI === "1" ||
    env.GITHUB_EVENT_NAME === "pull_request" ||
    env.PKGCOMPASS_UNTRUSTED_PR === "true" ||
    Boolean(env.VERCEL_GIT_PULL_REQUEST_ID?.trim()) ||
    Boolean(env.VERCEL) || Boolean(env.VERCEL_ENV)) return "untrusted_execution_context";
  return null;
}

export function buildBrevoSmokeChildEnvironment(localEnvironment, sourceEnvironment, testFile) {
  const childEnvironment = Object.fromEntries(
    childRuntimeNames.flatMap((name) => sourceEnvironment[name]
      ? [[name, sourceEnvironment[name]]]
      : []),
  );
  childEnvironment.NODE_ENV = "test";
  childEnvironment.APP_ENV = "development";
  childEnvironment.BREVO_API_KEY = localEnvironment.BREVO_API_KEY;
  childEnvironment.BREVO_REQUEST_LIST_ID = localEnvironment.BREVO_REQUEST_LIST_ID;
  if (testFile.includes("contact-live")) {
    childEnvironment.FP04_TEST_EMAIL = localEnvironment.FP04_TEST_EMAIL;
  }
  childEnvironment.PKGCOMPASS_BREVO_LIVE_SMOKE = testFile;
  return childEnvironment;
}

export function runBrevoLiveSmoke(testFile) {
  const launchError = validateBrevoLiveSmokeLaunch(process.argv.slice(2), process.env);
  if (launchError) {
    emit("fail", launchError);
    process.exitCode = 1;
    return;
  }
  let localEnvironment;
  try {
    localEnvironment = parseEnv(readFileSync(".env.local", "utf8"));
  } catch {
    emit("fail", "local_environment_unavailable");
    process.exitCode = 1;
    return;
  }
  if (localEnvironment.APP_ENV && localEnvironment.APP_ENV !== "development") {
    emit("fail", "environment_mismatch");
    process.exitCode = 1;
    return;
  }
  if (!localEnvironment.BREVO_API_KEY || !localEnvironment.BREVO_REQUEST_LIST_ID ||
    (testFile.includes("contact-live") && !localEnvironment.FP04_TEST_EMAIL)) {
    emit("fail", "local_crm_configuration_incomplete");
    process.exitCode = 1;
    return;
  }

  const childEnvironment = buildBrevoSmokeChildEnvironment(localEnvironment, process.env, testFile);

  const child = spawnSync(process.execPath, [
    resolve("node_modules/vitest/vitest.mjs"),
    "run",
    testFile,
  ], {
    cwd: process.cwd(),
    env: childEnvironment,
    timeout: testFile.includes("contact-live") ? 180_000 : 60_000,
    stdio: "inherit",
  });

  if (child.error || child.status === null) {
    emit("fail", "vitest_runner_unavailable");
    process.exitCode = 1;
  } else {
    process.exitCode = child.status;
  }
}
