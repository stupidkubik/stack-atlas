import { readFile } from "node:fs/promises";
import { Client } from "pg";
import {
  SafeDatabaseCliError,
  isDirectExecution,
  parseDatabaseCliArgs,
  safePostgresErrorCode,
  validateDatabaseCliEnvironment,
  validatePostgresUrl,
} from "./cli.mjs";

export const bootstrapRoleNames = [
  "pkgcompass_public_reader",
  "pkgcompass_metrics_writer",
  "pkgcompass_lead_writer",
  "pkgcompass_migration_owner",
];

export async function runRoleBootstrapCli(argv = process.argv.slice(2), source = process.env) {
  const args = parseDatabaseCliArgs(argv);
  const connectionString = validatePostgresUrl(source.DATABASE_MIGRATION_URL);
  validateDatabaseCliEnvironment(args, source, connectionString);
  if (args.mode === "dry-run") {
    console.log(`DRY-RUN ${args.environment}: bootstrap ${bootstrapRoleNames.length} database roles.`);
    return;
  }

  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
    application_name: "pkgcompass-role-bootstrap",
  });
  try {
    await client.connect();
    const sql = await readFile(new URL("./bootstrap-roles.sql", import.meta.url), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
    console.log(`APPLY ${args.environment}: bootstrapped ${bootstrapRoleNames.length} database roles.`);
  } catch (error) {
    if (error instanceof SafeDatabaseCliError) throw error;
    throw new SafeDatabaseCliError(safePostgresErrorCode(error));
  } finally {
    await client.end().catch(() => undefined);
  }
}

if (isDirectExecution(import.meta.url)) {
  runRoleBootstrapCli().catch((error) => {
    const code = error instanceof SafeDatabaseCliError ? error.code : "db_operation_failed";
    console.error(`Database role bootstrap failed (${code}).`);
    process.exitCode = 1;
  });
}
