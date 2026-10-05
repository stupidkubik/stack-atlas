import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate as applyDrizzleMigrations } from "drizzle-orm/node-postgres/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";

export class SafeDatabaseCliError extends Error {
  constructor(code) {
    super(code);
    this.name = "SafeDatabaseCliError";
    this.code = code;
  }
}

export function parseDatabaseCliArgs(argv) {
  let environment;
  let mode;
  let allowProduction = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--env") {
      if (environment || !argv[index + 1] || argv[index + 1].startsWith("--")) {
        throw new SafeDatabaseCliError("db_cli_invalid_arguments");
      }
      environment = argv[index + 1];
      index += 1;
    } else if (argument === "--dry-run" || argument === "--apply") {
      if (mode) throw new SafeDatabaseCliError("db_cli_invalid_arguments");
      mode = argument === "--dry-run" ? "dry-run" : "apply";
    } else if (argument === "--allow-production") {
      if (allowProduction) throw new SafeDatabaseCliError("db_cli_invalid_arguments");
      allowProduction = true;
    } else {
      throw new SafeDatabaseCliError("db_cli_invalid_arguments");
    }
  }

  if (!environment || !mode || !["fixture", "development", "production"].includes(environment)) {
    throw new SafeDatabaseCliError("db_cli_invalid_arguments");
  }
  if (allowProduction && environment !== "production") {
    throw new SafeDatabaseCliError("db_cli_invalid_arguments");
  }

  return { environment, mode, allowProduction };
}

export function validateDatabaseCliEnvironment(args, source = process.env, connectionString) {
  if (source.APP_ENV && source.APP_ENV !== args.environment) {
    throw new SafeDatabaseCliError("db_environment_mismatch");
  }
  if (args.environment === "fixture") {
    let safeConnectionString;
    try {
      safeConnectionString = validatePostgresUrl(connectionString);
    } catch {
      throw new SafeDatabaseCliError("db_fixture_requires_loopback");
    }
    if (!isLoopbackPostgresUrl(safeConnectionString)) {
      throw new SafeDatabaseCliError("db_fixture_requires_loopback");
    }
    return;
  }
  if (
    (source.VERCEL_ENV === "production" && args.environment !== "production") ||
    (source.VERCEL_ENV === "development" && args.environment !== "development") ||
    (source.VERCEL_ENV === "preview" &&
      (args.environment !== "development" || source.VERCEL !== "1" || source.PKGCOMPASS_TRUSTED_PREVIEW !== "true")) ||
    (source.VERCEL_ENV && !["production", "development", "preview"].includes(source.VERCEL_ENV))
  ) {
    throw new SafeDatabaseCliError("db_environment_mismatch");
  }
  if (
    source.GITHUB_EVENT_NAME === "pull_request" ||
    source.PKGCOMPASS_UNTRUSTED_PR === "true" ||
    (source.VERCEL_GIT_PULL_REQUEST_ID && source.PKGCOMPASS_TRUSTED_PREVIEW !== "true")
  ) {
    throw new SafeDatabaseCliError("db_untrusted_context");
  }
  if (args.environment === "production" && !args.allowProduction) {
    throw new SafeDatabaseCliError("db_production_guard_required");
  }
}

export function validatePostgresUrl(value, setting = "DATABASE_MIGRATION_URL") {
  try {
    const url = new URL(value ?? "");
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const normalizedHost = host.toLowerCase();
    const localHosts = ["localhost", "127.0.0.1", "::1"];
    const databaseName = url.pathname.slice(1);
    const supportedParameters = new Map([
      ["sslmode", new Set(["require", "verify-full"])],
      ["channel_binding", new Set(["require", "prefer"])],
    ]);
    const hasUnsafeParameters = [...new Set(url.searchParams.keys())].some((key) => {
      const values = url.searchParams.getAll(key);
      const allowedValues = supportedParameters.get(key);
      return !allowedValues || values.length !== 1 || !allowedValues.has(values[0]);
    });
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !normalizedHost ||
      !url.username ||
      (!url.password && !localHosts.includes(normalizedHost)) ||
      !/^[A-Za-z0-9_.-]+$/.test(databaseName) ||
      url.hash || normalizedHost.includes("-pooler") || hasUnsafeParameters
    ) {
      throw new Error("invalid");
    }
    return url.toString();
  } catch {
    throw new SafeDatabaseCliError(`db_invalid_${setting.toLowerCase()}`);
  }
}

function isLoopbackPostgresUrl(value) {
  try {
    const url = new URL(value ?? "");
    return ["localhost", "127.0.0.1", "::1"].includes(
      url.hostname.replace(/^\[|\]$/g, "").toLowerCase(),
    );
  } catch {
    return false;
  }
}

export function migrationFolderFromRoot(root = process.cwd()) {
  return resolve(root, "migrations");
}

function readJournal(migrationsFolder) {
  let journal;
  try {
    journal = JSON.parse(readFileSync(resolve(migrationsFolder, "meta/_journal.json"), "utf8"));
  } catch {
    throw new SafeDatabaseCliError("db_migration_metadata_invalid");
  }

  if (
    !journal || journal.version !== "7" || journal.dialect !== "postgresql" ||
    !Array.isArray(journal.entries)
  ) {
    throw new SafeDatabaseCliError("db_migration_metadata_invalid");
  }
  return journal;
}

function loadLocalMigrations(migrationsFolder) {
  const journal = readJournal(migrationsFolder);
  const entries = journal.entries;
  let migrations;
  try {
    migrations = readMigrationFiles({ migrationsFolder });
  } catch {
    throw new SafeDatabaseCliError("db_migration_metadata_invalid");
  }

  if (migrations.length !== entries.length) {
    throw new SafeDatabaseCliError("db_migration_metadata_invalid");
  }

  const seenTags = new Set();
  let previousTimestamp = -1;
  return entries.map((entry, index) => {
    if (
      !entry || !Number.isInteger(entry.idx) || entry.idx !== index ||
      !Number.isSafeInteger(entry.when) || entry.when <= previousTimestamp ||
      typeof entry.tag !== "string" || !/^\d{4}_[a-z0-9_]+$/.test(entry.tag) || seenTags.has(entry.tag)
    ) {
      throw new SafeDatabaseCliError("db_migration_metadata_invalid");
    }
    previousTimestamp = entry.when;
    seenTags.add(entry.tag);
    return { ...migrations[index], tag: entry.tag };
  });
}

export async function inspectMigrationPlan(client, migrationsFolder, migrationsSchema = "drizzle") {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(migrationsSchema)) {
    throw new SafeDatabaseCliError("db_migration_schema_invalid");
  }
  const localMigrations = loadLocalMigrations(migrationsFolder);
  const relationName = `${migrationsSchema}.__drizzle_migrations`;
  const relation = await client.query("SELECT to_regclass($1) IS NOT NULL AS exists", [relationName]);
  let applied = [];

  if (relation.rows[0]?.exists) {
    const result = await client.query(
      `SELECT hash, created_at FROM "${migrationsSchema}"."__drizzle_migrations" ORDER BY created_at, id`,
    );
    applied = result.rows;
  }

  if (applied.length > localMigrations.length) {
    throw new SafeDatabaseCliError("db_migration_history_unknown");
  }
  for (let index = 0; index < applied.length; index += 1) {
    const row = applied[index];
    const local = localMigrations[index];
    if (Number(row.created_at) !== local.folderMillis) {
      throw new SafeDatabaseCliError("db_migration_history_order_invalid");
    }
    if (row.hash !== local.hash) {
      throw new SafeDatabaseCliError("db_migration_history_hash_mismatch");
    }
  }

  return {
    applied: applied.length,
    pending: localMigrations.slice(applied.length).map(({ tag }) => tag),
    migrationsSchema,
  };
}

export async function applyMigrationPlan(client, migrationsFolder, migrationsSchema = "drizzle") {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(migrationsSchema)) {
    throw new SafeDatabaseCliError("db_migration_schema_invalid");
  }
  await client.query("SELECT pg_advisory_lock(hashtext($1), 1)", ["pkgcompass:migrations"]);
  try {
    await inspectMigrationPlan(client, migrationsFolder, migrationsSchema);
    await applyDrizzleMigrations(drizzle(client), { migrationsFolder, migrationsSchema });
    return inspectMigrationPlan(client, migrationsFolder, migrationsSchema);
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext($1), 1)", ["pkgcompass:migrations"]);
  }
}

export function safePostgresErrorCode(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  const safeDriverCode = /^[A-Z][A-Z0-9_]{1,31}$/.test(code);
  const safeSqlState = /^[A-Z0-9]{5}$/.test(code);
  return safeDriverCode || safeSqlState ? `db_${code.toLowerCase()}` : "db_operation_failed";
}

export function isDirectExecution(metaUrl) {
  return Boolean(process.argv[1]) && pathToFileURL(resolve(process.argv[1])).href === metaUrl;
}
