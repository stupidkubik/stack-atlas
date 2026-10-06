export function validateBrevoLiveSmokeLaunch(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): "usage" | "environment_mismatch" | "untrusted_execution_context" | null;
export function buildBrevoSmokeChildEnvironment(
  localEnvironment: Readonly<Record<string, string | undefined>>,
  sourceEnvironment: Readonly<Record<string, string | undefined>>,
  testFile: string,
): Record<string, string | undefined>;
export function runBrevoLiveSmoke(testFile: string): void;
