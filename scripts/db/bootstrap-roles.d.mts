export const bootstrapRoleNames: readonly string[];
export function runRoleBootstrapCli(
  argv?: readonly string[],
  source?: Readonly<Record<string, string | undefined>>,
): Promise<void>;
