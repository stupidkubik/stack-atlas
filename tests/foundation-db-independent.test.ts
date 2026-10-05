import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client, Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { selectComponentTarget } from "../src/server/config/targets";
import {
  createDirectMetricsWriterSession,
  createDirectMigrationSession,
  createPooledLeadWriter,
  createPooledMetricsReader,
} from "../src/server/db/connections";

import {
  applyMigrationPlan,
  inspectMigrationPlan,
  parseDatabaseCliArgs,
  safePostgresErrorCode,
  validateDatabaseCliEnvironment,
  validatePostgresUrl,
} from "../scripts/db/cli.mjs";
import { runMigrationsCli } from "../scripts/db/migrate.mjs";

const configuredDatabaseUrl = process.env.DATABASE_TEST_URL;
let reviewDatabase: URL | undefined;
let testUrlIsValid = false;
try {
  if (configuredDatabaseUrl) {
    validatePostgresUrl(configuredDatabaseUrl, "DATABASE_TEST_URL");
    reviewDatabase = new URL(configuredDatabaseUrl);
    testUrlIsValid = true;
  }
} catch {
  reviewDatabase = undefined;
}
const isLoopback = testUrlIsValid && reviewDatabase !== undefined &&
  ["postgres:", "postgresql:"].includes(reviewDatabase.protocol) &&
  ["localhost", "127.0.0.1", "::1"].includes(reviewDatabase.hostname) &&
  reviewDatabase.port === "55437" &&
  reviewDatabase.pathname === "/pkgcompass_fp03_review" &&
  reviewDatabase.search === "" && reviewDatabase.hash === "" &&
  reviewDatabase.username === "fixture_admin";

if (configuredDatabaseUrl && !isLoopback) {
  throw new Error("DATABASE_TEST_URL must target the isolated loopback review database.");
}

const databaseDescribe = isLoopback ? describe : describe.skip;
const bootstrapRolesSql = readFileSync(resolve(process.cwd(), "scripts/db/bootstrap-roles.sql"), "utf8");

function makeMigrationFolder(migrations: readonly string[]): string {
  const folder = mkdtempSync(join(tmpdir(), "pkgcompass-fp03-review-"));
  const metadata = join(folder, "meta");
  mkdirSync(metadata, { recursive: true });
  const timestamp = 1_760_000_000_000;
  const entries = migrations.map((_, index) => ({
    idx: index,
    version: "7",
    when: timestamp + index,
    tag: `000${index}_review_${index}`,
    breakpoints: true,
  }));
  writeFileSync(join(metadata, "_journal.json"), JSON.stringify({
    version: "7",
    dialect: "postgresql",
    entries,
  }));
  migrations.forEach((sql, index) => writeFileSync(join(folder, `${entries[index].tag}.sql`), sql));
  return folder;
}

async function withReviewClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  if (!configuredDatabaseUrl || !isLoopback) {
    throw new Error("The isolated review database is not configured.");
  }
  const client = new Client({
    connectionString: configuredDatabaseUrl,
    connectionTimeoutMillis: 5_000,
    application_name: "pkgcompass-fp03-independent-review",
  });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

async function expectDeniedAsRole(client: Client, role: string, statement: string): Promise<void> {
  await client.query(`SET ROLE ${role}`);
  await client.query("SAVEPOINT expected_denial");
  await expect(client.query(statement)).rejects.toMatchObject({ code: "42501" });
  await client.query("ROLLBACK TO SAVEPOINT expected_denial");
  await client.query("RELEASE SAVEPOINT expected_denial");
  await client.query("RESET ROLE");
}

describe("independent FP-03 boundary probes", () => {
  it("requires an explicit CLI target and mode, with production apply guarded", () => {
    expect(() => parseDatabaseCliArgs(["--apply"])).toThrow();
    expect(() => parseDatabaseCliArgs(["--env", "development"])).toThrow();
    expect(parseDatabaseCliArgs(["--env", "development", "--dry-run"]))
      .toMatchObject({ environment: "development", mode: "dry-run", allowProduction: false });
    expect(() => parseDatabaseCliArgs(["--env", "development", "--dry-run", "--apply"])).toThrow();

    const productionApply = parseDatabaseCliArgs(["--env", "production", "--apply"]);
    expect(() => validateDatabaseCliEnvironment(productionApply, {
      APP_ENV: "production",
      VERCEL: "1",
      VERCEL_ENV: "production",
    })).toThrow("db_production_guard_required");
    expect(() => validateDatabaseCliEnvironment({ ...productionApply, allowProduction: true }, {
      APP_ENV: "production",
      VERCEL: "1",
      VERCEL_ENV: "production",
    })).not.toThrow();
    const productionDryRun = parseDatabaseCliArgs(["--env", "production", "--dry-run"]);
    expect(() => validateDatabaseCliEnvironment(
      productionDryRun,
      { APP_ENV: "production", VERCEL: "1", VERCEL_ENV: "production" },
    )).toThrow("db_production_guard_required");
    expect(() => validateDatabaseCliEnvironment(
      { ...productionDryRun, allowProduction: true },
      { APP_ENV: "production", VERCEL: "1", VERCEL_ENV: "production" },
    )).not.toThrow();
  });

  it("lets an explicit CLI environment select local targets while rejecting conflicts and untrusted PRs", () => {
    const development = parseDatabaseCliArgs(["--env", "development", "--dry-run"]);
    expect(() => validateDatabaseCliEnvironment(development, {})).not.toThrow();
    expect(() => validateDatabaseCliEnvironment(development, {
      APP_ENV: "production",
    })).toThrow("db_environment_mismatch");
    expect(() => validateDatabaseCliEnvironment(development, {
      APP_ENV: "development",
      VERCEL: "1",
      VERCEL_ENV: "preview",
      VERCEL_GIT_PULL_REQUEST_ID: "42",
      PKGCOMPASS_TRUSTED_PREVIEW: "true",
    })).not.toThrow();
    expect(() => validateDatabaseCliEnvironment(development, {
      APP_ENV: "development",
      GITHUB_EVENT_NAME: "pull_request",
    })).toThrow("db_untrusted_context");

    const fixture = parseDatabaseCliArgs(["--env", "fixture", "--dry-run"]);
    expect(() => validateDatabaseCliEnvironment(
      fixture,
      {},
      "postgresql://fixture_admin@127.0.0.1:55437/pkgcompass_fp03_review",
    )).not.toThrow();
    expect(() => validateDatabaseCliEnvironment(
      fixture,
      {},
      "postgresql://fixture_admin:secret@db.example.invalid/pkgcompass_fp03_review",
    )).toThrow("db_fixture_requires_loopback");
  });

  it("rejects unsafe direct URL shapes and keeps credentials out of errors", () => {
    const passwordSentinel = "review-private-password-sentinel";
    const loopbackUrl = "postgresql://fixture_admin@127.0.0.1:55437/pkgcompass_fp03_review";
    expect(validatePostgresUrl(loopbackUrl)).toBe(loopbackUrl);
    expect(() => validatePostgresUrl(
      `postgresql://fixture_admin:${passwordSentinel}@ep-review-pooler.example.invalid/pkgcompass_fp03_review`,
    )).toThrow();
    expect(() => validatePostgresUrl(
      "postgresql://fixture_admin:fixture@EP-X-POOLER.example.invalid/pkgcompass_fp03_review",
    )).toThrow();
    expect(() => validatePostgresUrl(`${loopbackUrl}?host=ep-review-pooler.example.invalid`)).toThrow();
    expect(() => validatePostgresUrl(`${loopbackUrl}?user=other`)).toThrow();
    expect(() => validatePostgresUrl(`${loopbackUrl}?password=${passwordSentinel}`)).toThrow();
    expect(() => validatePostgresUrl(`${loopbackUrl}?port=5432`)).toThrow();
    expect(() => validatePostgresUrl(`${loopbackUrl}?sslkey=%2Ftmp%2Freview-key`)).toThrow();
    expect(() => validatePostgresUrl(`${loopbackUrl}?sslrootcert=%2Ftmp%2Freview-cert`)).toThrow();
    expect(() => validatePostgresUrl(`${loopbackUrl}?service=review`)).toThrow();
    expect(() => validatePostgresUrl(`${loopbackUrl}?options=-c%20role%3Dpkgcompass_migration_owner`)).toThrow();
    expect(() => validatePostgresUrl(`${loopbackUrl}?unknown=review`)).toThrow();
    expect(() => validatePostgresUrl(`${loopbackUrl}#fragment`)).toThrow();

    const targetSource = {
      APP_ENV: "development",
      DATABASE_IMPORT_URL: `${loopbackUrl}?host=ep-review-pooler.example.invalid`,
    };
    expect(() => selectComponentTarget("metricsWriter", targetSource)).toThrow("DATABASE_IMPORT_URL");

    let error: unknown;
    try {
      validatePostgresUrl(`https://${passwordSentinel}@not-a-database.invalid/path`);
    } catch (caught) {
      error = caught;
    }
    expect(String(error)).not.toContain(passwordSentinel);
    expect(String(error)).not.toContain("not-a-database.invalid");
    expect(safePostgresErrorCode({
      code: "28P01",
      message: passwordSentinel,
      detail: passwordSentinel,
    })).toBe("db_28p01");
  });

  it("rejects reordered migration timestamps and unsafe migration schema identifiers before SQL", async () => {
    const folder = makeMigrationFolder(["SELECT 1;", "SELECT 2;"]);
    const emptyFolder = makeMigrationFolder([]);
    const journalPath = join(folder, "meta/_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
      entries: Array<{ when: number }>;
    };
    journal.entries[1].when = journal.entries[0].when - 1;
    writeFileSync(journalPath, JSON.stringify(journal));
    const query = vi.fn(() => { throw new Error("SQL should not run"); });
    const fakeClient = { query };

    try {
      await expect(inspectMigrationPlan(fakeClient, folder)).rejects.toMatchObject({
        code: "db_migration_metadata_invalid",
      });
      await expect(inspectMigrationPlan(fakeClient, emptyFolder, 'drizzle"; DROP SCHEMA public; --'))
        .rejects.toMatchObject({ code: "db_migration_schema_invalid" });
      expect(query).not.toHaveBeenCalled();
    } finally {
      rmSync(folder, { recursive: true, force: true });
      rmSync(emptyFolder, { recursive: true, force: true });
    }
  });

  it("routes web through pooled factories and collector/migration through direct sessions", async () => {
    if (!configuredDatabaseUrl || !isLoopback) return;
    const source = {
      APP_ENV: "development",
      DATABASE_READ_URL: configuredDatabaseUrl,
      DATABASE_LEAD_URL: configuredDatabaseUrl,
      DATABASE_IMPORT_URL: configuredDatabaseUrl,
      DATABASE_MIGRATION_URL: configuredDatabaseUrl,
    };
    const metrics = createPooledMetricsReader(source);
    const leads = createPooledLeadWriter(source);
    const collector = createDirectMetricsWriterSession(source);
    const migrations = createDirectMigrationSession(source);

    try {
      expect(metrics.pool).toBeInstanceOf(Pool);
      expect(leads.pool).toBeInstanceOf(Pool);
      expect(collector.client).toBeInstanceOf(Client);
      expect(migrations.client).toBeInstanceOf(Client);
    } finally {
      await Promise.all([metrics.close(), leads.close(), collector.close(), migrations.close()]);
    }
  });

  databaseDescribe("temporary PostgreSQL role and migration behavior", () => {
    it("uses a true dry-run that leaves migration schema and history untouched", async () => {
      await withReviewClient(async (client) => {
        const before = await client.query(
          "SELECT to_regclass('drizzle.__drizzle_migrations')::text AS relation",
        );
        await runMigrationsCli(["--env", "development", "--dry-run"], {
          DATABASE_MIGRATION_URL: configuredDatabaseUrl,
        });
        const after = await client.query(
          "SELECT to_regclass('drizzle.__drizzle_migrations')::text AS relation",
        );
        expect(after.rows).toEqual(before.rows);
      });
    });

    it("applies a migration once, leaves a repeat unchanged, and detects history corruption", async () => {
      const token = randomUUID().replaceAll("-", "");
      const migrationSchema = `drizzle_fp03_${token}`;
      const appSchema = `probe_fp03_${token}`;
      const table = `current_${token}`;
      const folder = makeMigrationFolder([`CREATE SCHEMA ${appSchema};\nCREATE TABLE ${appSchema}.${table} (id integer PRIMARY KEY);`]);

      try {
        await withReviewClient(async (client) => {
          const first = await applyMigrationPlan(client, folder, migrationSchema);
          expect(first).toMatchObject({ applied: 1, pending: [] });
          await client.query(`INSERT INTO ${appSchema}.${table} (id) VALUES (1)`);
          const beforeRepeat = await client.query(
            `SELECT id, hash, created_at FROM ${migrationSchema}.__drizzle_migrations ORDER BY id`,
          );

          const second = await applyMigrationPlan(client, folder, migrationSchema);
          const afterRepeat = await client.query(
            `SELECT id, hash, created_at FROM ${migrationSchema}.__drizzle_migrations ORDER BY id`,
          );
          const rows = await client.query(`SELECT id FROM ${appSchema}.${table}`);
          expect(second).toMatchObject({ applied: 1, pending: [] });
          expect(afterRepeat.rows).toEqual(beforeRepeat.rows);
          expect(rows.rows).toEqual([{ id: 1 }]);

          const migrationFile = join(folder, "0000_review_0.sql");
          writeFileSync(migrationFile, "CREATE TABLE public.changed_after_apply (id integer);");
          await expect(inspectMigrationPlan(client, folder, migrationSchema)).rejects.toMatchObject({
            code: "db_migration_history_hash_mismatch",
          });
        });
      } finally {
        await withReviewClient(async (client) => {
          await client.query(`DROP SCHEMA IF EXISTS ${appSchema} CASCADE`);
          await client.query(`DROP SCHEMA IF EXISTS ${migrationSchema} CASCADE`);
        });
        rmSync(folder, { recursive: true, force: true });
      }
    });

    it("rolls back DDL and does not record a failed migration", async () => {
      const token = randomUUID().replaceAll("-", "");
      const migrationSchema = `drizzle_fp03_${token}`;
      const appSchema = `rollback_fp03_${token}`;
      const folder = makeMigrationFolder([
        `CREATE SCHEMA ${appSchema};\n--> statement-breakpoint\nCREATE TABLE ${appSchema}.must_rollback (id integer);\n--> statement-breakpoint\nSELECT 1 / 0;`,
      ]);

      try {
        await withReviewClient(async (client) => {
          await expect(applyMigrationPlan(client, folder, migrationSchema)).rejects.toThrow();
          const appSchemaExists = await client.query("SELECT to_regnamespace($1) IS NOT NULL AS exists", [appSchema]);
          const history = await client.query(
            `SELECT hash, created_at FROM ${migrationSchema}.__drizzle_migrations`,
          );
          expect(appSchemaExists.rows[0].exists).toBe(false);
          expect(history.rows).toEqual([]);
        });
      } finally {
        await withReviewClient(async (client) => {
          await client.query(`DROP SCHEMA IF EXISTS ${appSchema} CASCADE`);
          await client.query(`DROP SCHEMA IF EXISTS ${migrationSchema} CASCADE`);
        });
        rmSync(folder, { recursive: true, force: true });
      }
    });

    it("bootstraps non-escalating role groups and enforces positive and private-negative SQL access", async () => {
      const token = randomUUID().replaceAll("-", "");
      const metricsTable = `fp03_metrics_${token}`;
      const leadsTable = `fp03_leads_${token}`;
      const ownerTable = `fp03_owner_${token}`;
      const roleNames = [
        "pkgcompass_public_reader",
        "pkgcompass_metrics_writer",
        "pkgcompass_lead_writer",
        "pkgcompass_migration_owner",
      ];

      await withReviewClient(async (client) => {
        // Keep the roles for the CREATE DATABASE probe, which must run outside
        // a transaction. The repeated bootstrap below also checks idempotency.
        await client.query(bootstrapRolesSql);
        await client.query("BEGIN");
        try {
          await client.query(bootstrapRolesSql);
          const roles = await client.query(
            "SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = ANY($1::text[]) ORDER BY rolname",
            [roleNames],
          );
          expect(roles.rows).toHaveLength(4);
          for (const role of roles.rows) {
            expect(role).toMatchObject({
              rolcanlogin: true,
              rolsuper: false,
              rolcreatedb: false,
              rolcreaterole: false,
              rolreplication: false,
              rolbypassrls: false,
            });
          }

          const publicPrivileges = await client.query(
            "SELECT COALESCE(array_agg(privilege_type ORDER BY privilege_type), ARRAY[]::text[]) AS privileges FROM pg_namespace AS namespace CROSS JOIN LATERAL aclexplode(COALESCE(namespace.nspacl, acldefault('n', namespace.nspowner))) AS acl WHERE namespace.nspname = 'public' AND acl.grantee = 0",
          );
          expect(publicPrivileges.rows[0].privileges).not.toContain("CREATE");
          expect(publicPrivileges.rows[0].privileges).not.toContain("USAGE");

          for (const role of roleNames.slice(0, -1)) {
            const escalation = await client.query(
              "SELECT pg_has_role($1, 'pkgcompass_migration_owner', 'MEMBER') AS can_escalate",
              [role],
            );
            expect(escalation.rows[0].can_escalate).toBe(false);
          }

          await client.query(`GRANT pkgcompass_migration_owner TO pkgcompass_public_reader`);
          await client.query("SAVEPOINT unexpected_membership");
          let bootstrapRejectedUnexpectedMembership = false;
          try {
            await client.query(bootstrapRolesSql);
          } catch {
            bootstrapRejectedUnexpectedMembership = true;
            await client.query("ROLLBACK TO SAVEPOINT unexpected_membership");
          }
          const unexpectedMembership = await client.query(
            "SELECT pg_has_role('pkgcompass_public_reader', 'pkgcompass_migration_owner', 'MEMBER') AS can_escalate",
          );
          expect(bootstrapRejectedUnexpectedMembership || !unexpectedMembership.rows[0].can_escalate).toBe(true);
          await client.query("REVOKE pkgcompass_migration_owner FROM pkgcompass_public_reader");

          await client.query(`CREATE TABLE public.${metricsTable} (id integer PRIMARY KEY)`);
          await client.query(`CREATE TABLE public.${leadsTable} (id integer PRIMARY KEY)`);
          await client.query("GRANT USAGE ON SCHEMA public TO pkgcompass_public_reader, pkgcompass_metrics_writer, pkgcompass_lead_writer, pkgcompass_migration_owner");
          await client.query(`GRANT SELECT ON public.${metricsTable} TO pkgcompass_public_reader`);
          await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON public.${metricsTable} TO pkgcompass_metrics_writer`);
          await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON public.${leadsTable} TO pkgcompass_lead_writer`);
          await client.query("GRANT CREATE ON SCHEMA public TO pkgcompass_migration_owner");

          await client.query(`INSERT INTO public.${metricsTable} (id) VALUES (1)`);
          await client.query(`INSERT INTO public.${leadsTable} (id) VALUES (1)`);
          await client.query("SET ROLE pkgcompass_public_reader");
          await expect(client.query(`SELECT id FROM public.${metricsTable}`)).resolves.toMatchObject({ rowCount: 1 });
          await expectDeniedAsRole(client, "pkgcompass_public_reader", `INSERT INTO public.${metricsTable} (id) VALUES (2)`);
          await expectDeniedAsRole(client, "pkgcompass_public_reader", `SELECT id FROM public.${leadsTable}`);
          await client.query("RESET ROLE");

          await client.query("SET ROLE pkgcompass_metrics_writer");
          await client.query(`INSERT INTO public.${metricsTable} (id) VALUES (2)`);
          await expectDeniedAsRole(client, "pkgcompass_metrics_writer", `SELECT id FROM public.${leadsTable}`);
          await expectDeniedAsRole(client, "pkgcompass_metrics_writer", `INSERT INTO public.${leadsTable} (id) VALUES (2)`);
          await client.query("RESET ROLE");

          await client.query("SET ROLE pkgcompass_lead_writer");
          await client.query(`INSERT INTO public.${leadsTable} (id) VALUES (2)`);
          await expectDeniedAsRole(client, "pkgcompass_lead_writer", `SELECT id FROM public.${metricsTable}`);
          await expectDeniedAsRole(client, "pkgcompass_lead_writer", `INSERT INTO public.${metricsTable} (id) VALUES (3)`);
          await client.query("RESET ROLE");

          await client.query("SET ROLE pkgcompass_migration_owner");
          await client.query(`CREATE TABLE public.${ownerTable} (id integer)`);
          await expectDeniedAsRole(client, "pkgcompass_migration_owner", `SELECT id FROM public.${leadsTable}`);
          await expectDeniedAsRole(
            client,
            "pkgcompass_migration_owner",
            `CREATE ROLE fp03_forbidden_${token} NOLOGIN`,
          );
          await expectDeniedAsRole(
            client,
            "pkgcompass_migration_owner",
            "ALTER ROLE pkgcompass_public_reader WITH SUPERUSER",
          );
          await client.query("RESET ROLE");
        } finally {
          await client.query("ROLLBACK");
        }

        await client.query("SET ROLE pkgcompass_migration_owner");
        await expect(client.query(`CREATE DATABASE fp03_forbidden_${token}`)).rejects.toMatchObject({
          code: "42501",
        });
        await client.query("RESET ROLE");
        const forbiddenDatabase = await client.query(
          "SELECT 1 FROM pg_database WHERE datname = $1",
          [`fp03_forbidden_${token}`],
        );
        expect(forbiddenDatabase.rows).toEqual([]);
      });
    });
  });
});
