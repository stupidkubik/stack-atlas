import type { MigrationPlan } from "./cli.mjs";

export function runMigrationsCli(
  argv?: readonly string[],
  source?: Readonly<Record<string, string | undefined>>,
): Promise<MigrationPlan>;
