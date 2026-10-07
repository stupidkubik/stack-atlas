export function validateLeadApiSmokeLaunch(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): "usage" | "environment_mismatch" | "untrusted_execution_context" | null;
export function validateLeadSmokeTargetSelectors(
  processEnv: Readonly<Record<string, string | undefined>>,
  localEnv: Readonly<Record<string, string | undefined>>,
): { readonly origin: string; readonly code?: never } | {
  readonly code: "app_env_not_development" | "environment_mismatch" | "site_origin_not_loopback";
  readonly origin?: never;
};
export function isDevelopmentRuntimeAttestation(
  status: number,
  body: Record<string, unknown> | null,
): boolean;
export function ownedContact(
  contact: Record<string, unknown> | null,
  identity: { readonly id: number; readonly email: string; readonly listId: number; readonly createdAt: string },
): boolean;
export function validateLeadDatabaseTarget(
  source: Readonly<Record<string, string | undefined>>,
): "lead_database_target_invalid" | "database_target_mismatch" | null;
