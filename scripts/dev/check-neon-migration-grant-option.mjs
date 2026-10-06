import { URL } from "node:url";
import { safePostgresErrorCode, validatePostgresUrl } from "../db/cli.mjs";

function emit(result, code, exitCode = 1) {
  process.stdout.write(`${JSON.stringify({ check: "neon_migration_schema_grant_option", ...result, ...(code ? { errorCode: code } : {}) })}\n`);
  if (code) process.exitCode = exitCode;
}

function untrusted(source) {
  return Boolean(source.CI && source.CI !== "false" && source.CI !== "0") ||
    Boolean(source.VERCEL || source.VERCEL_ENV || source.VERCEL_GIT_PULL_REQUEST_ID) ||
    source.GITHUB_EVENT_NAME === "pull_request" ||
    source.PKGCOMPASS_UNTRUSTED_PR === "true";
}

if (process.argv.length !== 4 || process.argv[2] !== "--env" || process.argv[3] !== "development") {
  emit({}, "development_flag_required", 2);
} else if (untrusted(process.env)) {
  emit({}, "untrusted_context", 2);
} else {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    emit({}, "env_file_unavailable", 2);
  }

  if (!process.exitCode) {
    let connectionString;
    try {
      connectionString = validatePostgresUrl(process.env.DATABASE_MIGRATION_URL);
      const parsed = new URL(connectionString);
      if (
        !parsed.hostname.toLowerCase().endsWith(".neon.tech") ||
        parsed.hostname.toLowerCase().includes("-pooler") ||
        decodeURIComponent(parsed.username) !== "pkgcompass_migration_owner"
      ) throw new Error("invalid_target");
    } catch {
      emit({}, "development_migration_target_invalid", 2);
    }

    if (!process.exitCode) {
      const { Client } = await import("pg");
      const client = new Client({
        connectionString,
        connectionTimeoutMillis: 7000,
        query_timeout: 7000,
        application_name: "pkgcompass-readonly-grant-diagnostic",
      });
      try {
        await client.connect();
        const { rows } = await client.query(`
          SELECT
            current_user = 'pkgcompass_migration_owner' AS expected_role,
            has_schema_privilege(current_user, 'public', 'USAGE') AS schema_usage,
            has_schema_privilege(current_user, 'public', 'CREATE') AS schema_create,
            EXISTS (
              SELECT 1
              FROM pg_namespace AS namespace
              CROSS JOIN LATERAL aclexplode(COALESCE(namespace.nspacl, acldefault('n', namespace.nspowner))) AS acl
              WHERE namespace.nspname = 'public'
                AND acl.grantee = (SELECT oid FROM pg_roles WHERE rolname = current_user)
                AND acl.privilege_type = 'USAGE'
                AND acl.is_grantable
            ) AS schema_usage_grant_option
        `);
        const status = rows[0] ?? {};
        const ok = status.expected_role === true && status.schema_usage === true &&
          status.schema_create === true && status.schema_usage_grant_option === true;
        emit({
          targetEnvironment: "development",
          expectedRole: status.expected_role === true,
          schemaUsage: status.schema_usage === true,
          schemaCreate: status.schema_create === true,
          schemaUsageGrantOption: status.schema_usage_grant_option === true,
          ok,
        }, ok ? undefined : "migration_owner_schema_grant_option_missing", ok ? 0 : 1);
      } catch (error) {
        emit({ targetEnvironment: "development" }, safePostgresErrorCode(error));
      } finally {
        await client.end().catch(() => {});
      }
    }
  }
}
