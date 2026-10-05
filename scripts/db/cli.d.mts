import type { Client } from "pg";

export type DatabaseEnvironment = "fixture" | "development" | "production";
export type DatabaseCliMode = "dry-run" | "apply";

export interface DatabaseCliArgs {
  readonly environment: DatabaseEnvironment;
  readonly mode: DatabaseCliMode;
  readonly allowProduction: boolean;
}

export interface MigrationPlan {
  readonly applied: number;
  readonly pending: readonly string[];
  readonly migrationsSchema: string;
}

export class SafeDatabaseCliError extends Error {
  readonly code: string;
  constructor(code: string);
}

export function parseDatabaseCliArgs(argv: readonly string[]): DatabaseCliArgs;
export function validateDatabaseCliEnvironment(
  args: DatabaseCliArgs,
  source?: Readonly<Record<string, string | undefined>>,
  connectionString?: string,
): void;
export function validatePostgresUrl(value: string | undefined, setting?: string): string;
export function migrationFolderFromRoot(root?: string): string;
export function inspectMigrationPlan(
  client: Pick<Client, "query">,
  migrationsFolder: string,
  migrationsSchema?: string,
): Promise<MigrationPlan>;
export function applyMigrationPlan(
  client: Pick<Client, "query">,
  migrationsFolder: string,
  migrationsSchema?: string,
): Promise<MigrationPlan>;
export function safePostgresErrorCode(error: unknown): string;
export function isDirectExecution(metaUrl: string): boolean;
