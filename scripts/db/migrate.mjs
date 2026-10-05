import { Client } from "pg";
import {
  SafeDatabaseCliError,
  applyMigrationPlan,
  inspectMigrationPlan,
  isDirectExecution,
  migrationFolderFromRoot,
  parseDatabaseCliArgs,
  safePostgresErrorCode,
  validateDatabaseCliEnvironment,
  validatePostgresUrl,
} from "./cli.mjs";

export async function runMigrationsCli(argv = process.argv.slice(2), source = process.env) {
  const args = parseDatabaseCliArgs(argv);
  const connectionString = validatePostgresUrl(source.DATABASE_MIGRATION_URL);
  validateDatabaseCliEnvironment(args, source, connectionString);
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
    application_name: "pkgcompass-migrations",
  });

  try {
    await client.connect();
    const folder = migrationFolderFromRoot();
    if (args.mode === "dry-run") {
      const plan = await inspectMigrationPlan(client, folder);
      const changes = plan.pending.length ? `: ${plan.pending.join(", ")}` : "";
      console.log(`DRY-RUN ${args.environment}: ${plan.pending.length} pending migration(s)${changes}.`);
      return plan;
    }

    const result = await applyMigrationPlan(client, folder);
    console.log(`APPLY ${args.environment}: ${result.applied} migration(s) recorded; ${result.pending.length} pending.`);
    return result;
  } catch (error) {
    if (error instanceof SafeDatabaseCliError) {
      throw error;
    }
    throw new SafeDatabaseCliError(safePostgresErrorCode(error));
  } finally {
    await client.end().catch(() => undefined);
  }
}

if (isDirectExecution(import.meta.url)) {
  runMigrationsCli().catch((error) => {
    const code = error instanceof SafeDatabaseCliError ? error.code : "db_operation_failed";
    console.error(`Database migration failed (${code}).`);
    process.exitCode = 1;
  });
}
