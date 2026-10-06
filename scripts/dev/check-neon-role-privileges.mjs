import { randomUUID } from "node:crypto";
import { URL } from "node:url";
import { safePostgresErrorCode } from "../db/cli.mjs";

const roles = [
  { setting: "DATABASE_READ_URL", role: "pkgcompass_public_reader", pooled: true },
  { setting: "DATABASE_IMPORT_URL", role: "pkgcompass_metrics_writer", pooled: false },
  { setting: "DATABASE_LEAD_URL", role: "pkgcompass_lead_writer", pooled: true },
  { setting: "DATABASE_MIGRATION_URL", role: "pkgcompass_migration_owner", pooled: false },
];

function report(results, errorCode) {
  process.stdout.write(`${JSON.stringify({ check: "neon_role_privileges", environment: "development", results, ...(errorCode ? { errorCode } : {}) })}\n`);
  if (errorCode) process.exitCode = 1;
}

function untrusted(source) {
  return Boolean(source.CI && source.CI !== "false" && source.CI !== "0") ||
    Boolean(source.VERCEL || source.VERCEL_ENV || source.VERCEL_GIT_PULL_REQUEST_ID) ||
    source.GITHUB_EVENT_NAME === "pull_request" || source.PKGCOMPASS_UNTRUSTED_PR === "true";
}

function validateTargets(source) {
  const targets = roles.map(({ setting, role, pooled }) => {
    try {
      const value = source[setting];
      const url = new URL(value ?? "");
      const host = url.hostname.toLowerCase();
      const username = decodeURIComponent(url.username);
      const pooler = host.includes("-pooler.");
      const database = url.pathname.slice(1);
      const allowedQuery = [...url.searchParams.keys()].every((key) =>
        ["sslmode", "channel_binding"].includes(key) && url.searchParams.getAll(key).length === 1 &&
        (key === "sslmode" ? ["require", "verify-full"].includes(url.searchParams.get(key)) : ["require", "prefer"].includes(url.searchParams.get(key))),
      );
      if (
        !["postgres:", "postgresql:"].includes(url.protocol) || !host.endsWith(".neon.tech") ||
        !username || !url.password || username !== role || pooler !== pooled || !allowedQuery ||
        !/^[A-Za-z0-9_.-]+$/.test(database) || url.hash ||
        !["require", "verify-full"].includes(url.searchParams.get("sslmode") ?? "")
      ) return undefined;
      return { setting, role, host: host.replace("-pooler.", "."), database, pooler };
    } catch {
      return undefined;
    }
  });
  if (targets.some((target) => !target)) return undefined;
  if (new Set(targets.map((target) => `${target.host}|${target.database}`)).size !== 1) return undefined;
  return targets;
}

async function expectDenied(client, sql, parameters = []) {
  await client.query("SAVEPOINT expected_denial");
  try {
    await client.query(sql, parameters);
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT expected_denial");
    await client.query("RELEASE SAVEPOINT expected_denial");
    return error?.code === "42501";
  }
  await client.query("ROLLBACK TO SAVEPOINT expected_denial");
  await client.query("RELEASE SAVEPOINT expected_denial");
  return false;
}

async function withClient(Client, target, run) {
  const client = new Client({
    connectionString: process.env[target.setting],
    connectionTimeoutMillis: 7000,
    query_timeout: 7000,
    application_name: "pkgcompass-readonly-and-rollback-role-check",
  });
  await client.connect();
  try {
    const who = await client.query("SELECT current_user = $1 AS expected_role", [target.role]);
    if (who.rows[0]?.expected_role !== true) throw new Error("role_mismatch");
    return await run(client);
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  if (process.argv.length !== 4 || process.argv[2] !== "--env" || process.argv[3] !== "development") {
    return report([], "development_flag_required");
  }
  if (untrusted(process.env)) return report([], "untrusted_context");
  try {
    process.loadEnvFile(".env.local");
  } catch {
    return report([], "env_file_unavailable");
  }
  if (untrusted(process.env) || (process.env.APP_ENV && process.env.APP_ENV.trim() !== "development")) {
    return report([], "environment_mismatch");
  }
  const targets = validateTargets(process.env);
  if (!targets) return report([], "development_targets_invalid");

  const { Client } = await import("pg");
  const probe = `__pkgcompass_acl_${randomUUID().replaceAll("-", "")}`;
  const results = [];
  try {
    const reader = targets[0];
    const readerResult = await withClient(Client, reader, async (client) => {
      await client.query("BEGIN");
      try {
        const readMetrics = await client.query("SELECT product_id FROM public.metrics_current LIMIT 0");
        const deniedLeads = await expectDenied(client, "SELECT request_id FROM public.lead_requests LIMIT 0");
        const deniedWrite = await expectDenied(client,
          "INSERT INTO public.metrics_current (product_id,source,metric,source_entity_id,source_identity,source_url,last_attempt_at,last_status,valid_value,valid_observed_at,valid_fetched_at,run_id,updated_at) VALUES ($1,'github','stars','repo_fp04_probe','probe-owner/probe-repo','https://github.com/probe-owner/probe-repo',now(),'ok','1'::jsonb,now(),now(),$2,now())",
          [probe, randomUUID()],
        );
        return { role: reader.role, connected: true, metricsReadAllowed: readMetrics.rowCount === 0, privateLeadReadDenied: deniedLeads, metricsWriteDenied: deniedWrite };
      } finally {
        await client.query("ROLLBACK");
      }
    });
    results.push(readerResult);

    const metricsWriter = targets[1];
    const metricsResult = await withClient(Client, metricsWriter, async (client) => {
      await client.query("BEGIN");
      try {
        await client.query(
          "INSERT INTO public.metrics_current (product_id,source,metric,source_entity_id,source_identity,source_url,last_attempt_at,last_status,valid_value,valid_observed_at,valid_fetched_at,run_id,updated_at) VALUES ($1,'github','stars','repo_fp04_probe','probe-owner/probe-repo','https://github.com/probe-owner/probe-repo',now(),'ok','1'::jsonb,now(),now(),$2,now())",
          [probe, randomUUID()],
        );
        await client.query("UPDATE public.metrics_current SET valid_value = '2'::jsonb WHERE product_id = $1", [probe]);
        const ownRead = await client.query("SELECT valid_value FROM public.metrics_current WHERE product_id = $1", [probe]);
        const deniedLeadRead = await expectDenied(client, "SELECT request_id FROM public.lead_requests LIMIT 0");
        const deniedDelete = await expectDenied(client, "DELETE FROM public.metrics_current WHERE product_id = $1", [probe]);
        return { role: metricsWriter.role, connected: true, metricsInsertUpdateReadAllowed: ownRead.rows[0]?.valid_value === 2, privateLeadReadDenied: deniedLeadRead, metricsDeleteDenied: deniedDelete };
      } finally {
        await client.query("ROLLBACK");
      }
    });
    results.push(metricsResult);

    const leadWriter = targets[2];
    const requestId = randomUUID();
    const leadResult = await withClient(Client, leadWriter, async (client) => {
      await client.query("BEGIN");
      try {
        await client.query(
          "INSERT INTO public.lead_requests (request_id,dedup_key,payload_hash,scenario,contact_permission_version,contact_permission_at,expires_at) VALUES ($1,$2,$3,'marketing_site','contact_v1',now(),now() + interval '30 days')",
          [requestId, "a".repeat(64), "b".repeat(64)],
        );
        await client.query("UPDATE public.lead_requests SET state = 'failed' WHERE request_id = $1", [requestId]);
        const ownRead = await client.query("SELECT state FROM public.lead_requests WHERE request_id = $1", [requestId]);
        await client.query(
          "INSERT INTO public.rate_limits (ip_hmac,occurred_at,expires_at) VALUES ($1,$2::timestamptz,$2::timestamptz + interval '24 hours')",
          ["c".repeat(64), new Date().toISOString()],
        );
        const rateRead = await client.query("SELECT count(*)::integer AS count FROM public.rate_limits WHERE ip_hmac = $1", ["c".repeat(64)]);
        await client.query("DELETE FROM public.rate_limits WHERE ip_hmac = $1", ["c".repeat(64)]);
        await client.query("DELETE FROM public.lead_requests WHERE request_id = $1", [requestId]);
        const deniedMetricRead = await expectDenied(client, "SELECT product_id FROM public.metrics_current LIMIT 0");
        return { role: leadWriter.role, connected: true, leadCrudAllowed: ownRead.rows[0]?.state === "failed" && rateRead.rows[0]?.count === 1, metricsReadDenied: deniedMetricRead };
      } finally {
        await client.query("ROLLBACK");
      }
    });
    results.push(leadResult);

    const migration = targets[3];
    const migrationResult = await withClient(Client, migration, async (client) => {
      await client.query("BEGIN");
      try {
        const grants = await client.query(`
          SELECT
            has_schema_privilege(current_user, 'public', 'USAGE') AS usage,
            has_schema_privilege(current_user, 'public', 'CREATE') AS create,
            EXISTS (
              SELECT 1 FROM pg_namespace AS namespace
              CROSS JOIN LATERAL aclexplode(COALESCE(namespace.nspacl, acldefault('n', namespace.nspowner))) AS acl
              WHERE namespace.nspname = 'public' AND acl.grantee = (SELECT oid FROM pg_roles WHERE rolname = current_user)
                AND acl.privilege_type = 'USAGE' AND acl.is_grantable
            ) AS usage_grant_option
        `);
        await client.query(`CREATE TABLE public."${probe}" (id integer)`);
        await client.query(`INSERT INTO public."${probe}" (id) VALUES (1)`);
        return {
          role: migration.role,
          connected: true,
          schemaUsage: grants.rows[0]?.usage === true,
          schemaCreate: grants.rows[0]?.create === true,
          usageGrantOption: grants.rows[0]?.usage_grant_option === true,
        };
      } finally {
        await client.query("ROLLBACK");
      }
    });
    results.push(migrationResult);

    const ok = results.length === roles.length && results.every((result) =>
      result.connected && Object.entries(result).filter(([key]) => key !== "role" && key !== "connected").every(([, value]) => value === true),
    );
    report(results, ok ? undefined : "role_privilege_assertion_failed");
  } catch (error) {
    const code = safePostgresErrorCode(error);
    report(results, code);
  }
}

await main();
