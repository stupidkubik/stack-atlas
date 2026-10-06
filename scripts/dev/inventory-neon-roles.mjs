import { URL } from "node:url";

const definitions = [
  ["DATABASE_READ_URL", "pkgcompass_public_reader", true],
  ["DATABASE_IMPORT_URL", "pkgcompass_metrics_writer", false],
  ["DATABASE_LEAD_URL", "pkgcompass_lead_writer", true],
  ["DATABASE_MIGRATION_URL", "pkgcompass_migration_owner", false],
];

function fail(errorCode, exitCode = 2) {
  process.stdout.write(`${JSON.stringify({ check: "neon_role_login", ok: false, errorCode })}\n`);
  process.exitCode = exitCode;
}

function isUntrustedContext(source) {
  return Boolean(source.CI && source.CI !== "false" && source.CI !== "0") ||
    Boolean(source.VERCEL || source.VERCEL_ENV || source.VERCEL_GIT_PULL_REQUEST_ID) ||
    source.GITHUB_EVENT_NAME === "pull_request" ||
    source.PKGCOMPASS_UNTRUSTED_PR === "true";
}

function requestedEnvironment(args) {
  if (args.length !== 2 || args[0] !== "--env" || args[1] !== "development") return undefined;
  return "development";
}

function parseTarget(setting, expectedRole, requiresPooler, env) {
  const value = env[setting];
  if (!value) return { setting, configured: false, valid: false };
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const pooled = host.includes("-pooler.");
    const normalizedHost = host.replace(/-pooler(?=\.)/u, "");
    const username = decodeURIComponent(url.username);
    const database = url.pathname.slice(1);
    const allowedValues = {
      sslmode: new Set(["require", "verify-full"]),
      channel_binding: new Set(["require", "prefer"]),
    };
    const queryKeys = [...url.searchParams.keys()];
    const queryValid = queryKeys.every((key) => allowedValues[key]?.has(url.searchParams.get(key))) &&
      queryKeys.every((key) => url.searchParams.getAll(key).length === 1);
    const valid = ["postgres:", "postgresql:"].includes(url.protocol) &&
      host.endsWith(".neon.tech") && Boolean(username && url.password && database) &&
      username === expectedRole && queryValid &&
      (url.searchParams.get("sslmode") === "require" || url.searchParams.get("sslmode") === "verify-full") &&
      pooled === requiresPooler;
    return {
      setting,
      configured: true,
      valid,
      expectedRole: username === expectedRole,
      endpoint: normalizedHost,
      database,
      port: url.port || "5432",
      pooler: pooled,
      queryValid,
      tlsRequired: url.searchParams.get("sslmode") === "require" || url.searchParams.get("sslmode") === "verify-full",
    };
  } catch {
    return { setting, configured: true, valid: false };
  }
}

function printTargetShape(targets, sameTarget) {
  return {
    configured: targets.every((target) => target.configured),
    valid: targets.every((target) => target.valid),
    sameTarget,
    rolesMatch: targets.every((target) => target.expectedRole),
    queryAndTlsValid: targets.every((target) => target.queryValid && target.tlsRequired),
    connectionModesMatch: targets.every((target, index) => target.pooler === definitions[index][2]),
  };
}

async function main() {
  const targetEnvironment = requestedEnvironment(process.argv.slice(2));
  if (!targetEnvironment) return fail("development_flag_required");
  if (isUntrustedContext(process.env)) return fail("untrusted_context");
  if (process.env.APP_ENV?.trim() && process.env.APP_ENV.trim() !== targetEnvironment) {
    return fail("app_env_mismatch");
  }

  try {
    process.loadEnvFile(".env.local");
  } catch {
    return fail("env_file_unavailable");
  }
  if (isUntrustedContext(process.env)) return fail("untrusted_context");
  if (process.env.APP_ENV?.trim() && process.env.APP_ENV.trim() !== targetEnvironment) {
    return fail("app_env_mismatch");
  }

  const targets = definitions.map(([setting, role, pooled]) => parseTarget(setting, role, pooled, process.env));
  const comparable = targets.filter((target) => target.endpoint && target.database);
  const sameTarget = comparable.length === definitions.length &&
    new Set(comparable.map((target) => `${target.endpoint}|${target.port}|${target.database}`)).size === 1;
  const targetShape = printTargetShape(targets, sameTarget);
  if (!targetShape.configured || !targetShape.valid || !targetShape.sameTarget ||
      !targetShape.rolesMatch || !targetShape.queryAndTlsValid || !targetShape.connectionModesMatch) {
    process.stdout.write(`${JSON.stringify({ check: "neon_role_login", targetEnvironment, targetShape, errorCode: "development_target_invalid" })}\n`);
    process.exitCode = 2;
    return;
  }

  let Client;
  try {
    ({ Client } = await import("pg"));
  } catch {
    return fail("driver_unavailable");
  }

  const logins = [];
  const observedDatabases = new Set();
  for (const [setting, expectedRole] of definitions) {
    const client = new Client({
      connectionString: process.env[setting],
      connectionTimeoutMillis: 7000,
      query_timeout: 7000,
    });
    try {
      await client.connect();
      const { rows } = await client.query("select current_user as role_name, current_database() as database_name");
      const row = rows[0];
      if (typeof row.database_name === "string") observedDatabases.add(row.database_name);
      logins.push({
        setting,
        connected: true,
        expectedRole: row.role_name === expectedRole,
        databasePresent: typeof row.database_name === "string" && row.database_name.length > 0,
      });
    } catch (error) {
      const code = typeof error?.code === "string" && /^[A-Z0-9_]{1,32}$/u.test(error.code)
        ? error.code
        : "unknown";
      logins.push({ setting, connected: false, errorCode: code });
    } finally {
      await client.end().catch(() => {});
    }
  }

  const ok = logins.length === definitions.length && logins.every((login) => login.connected && login.expectedRole) &&
    observedDatabases.size === 1;
  process.stdout.write(`${JSON.stringify({
    check: "neon_role_login",
    targetEnvironment,
    targetShape,
    sameDatabaseAfterLogin: observedDatabases.size === 1,
    roleLogins: logins,
    ok,
  })}\n`);
  if (!ok) process.exitCode = 1;
}

await main();
