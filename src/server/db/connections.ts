import "server-only";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Client, Pool } from "pg";
import { SafeConfigurationError, type EnvironmentSource } from "../config/environment";
import { selectComponentTarget } from "../config/targets";

export interface PooledMetricsReader {
  readonly db: NodePgDatabase;
  readonly pool: Pool;
  close(): Promise<void>;
}

export interface PooledLeadWriter {
  readonly db: NodePgDatabase;
  readonly pool: Pool;
  close(): Promise<void>;
}

export interface DirectDatabaseSession {
  readonly db: NodePgDatabase;
  readonly client: Client;
  connect(): Promise<void>;
  close(): Promise<void>;
}

function unavailable(component: string): never {
  throw new SafeConfigurationError({ code: "adapter_unavailable", component });
}

export function createPooledMetricsReader(source: EnvironmentSource = process.env): PooledMetricsReader {
  const target = selectComponentTarget("metricsReader", source);
  if (target.mode === "fixture") unavailable("metricsReader");

  const pool = new Pool({
    connectionString: target.settings.DATABASE_READ_URL,
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    application_name: "pkgcompass-web",
  });

  return { db: drizzle(pool), pool, close: () => pool.end() };
}

export function createPooledLeadWriter(source: EnvironmentSource = process.env): PooledLeadWriter {
  const target = selectComponentTarget("leadWriter", source);
  if (target.mode === "fixture") unavailable("leadWriter");

  const pool = new Pool({
    connectionString: target.settings.DATABASE_LEAD_URL,
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    application_name: "pkgcompass-web-leads",
  });

  return { db: drizzle(pool), pool, close: () => pool.end() };
}

export function createDirectMetricsWriterSession(source: EnvironmentSource = process.env): DirectDatabaseSession {
  const target = selectComponentTarget("metricsWriter", source);
  if (target.mode === "fixture") unavailable("metricsWriter");

  return createDirectSession(target.settings.DATABASE_IMPORT_URL, "pkgcompass-collector");
}

export function createDirectMigrationSession(source: EnvironmentSource = process.env): DirectDatabaseSession {
  const target = selectComponentTarget("databaseMigration", source);
  if (target.mode === "fixture") unavailable("databaseMigration");

  return createDirectSession(target.settings.DATABASE_MIGRATION_URL, "pkgcompass-migrations");
}

function createDirectSession(connectionString: string, applicationName: string): DirectDatabaseSession {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
    application_name: applicationName,
  });

  return {
    db: drizzle(client),
    client,
    connect: async () => { await client.connect(); },
    close: () => client.end(),
  };
}
