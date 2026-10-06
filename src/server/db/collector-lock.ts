import type { Client } from "pg";

export type CollectorEnvironment = "development" | "production";

const lockKeyPrefix = "pkgcompass:metrics-collector:";

export async function tryAcquireCollectorLock(
  client: Client,
  environment: CollectorEnvironment,
): Promise<boolean> {
  const result = await client.query<{ acquired: boolean }>(
    "SELECT pg_try_advisory_lock(hashtext($1), 1) AS acquired",
    [`${lockKeyPrefix}${environment}`],
  );
  return result.rows[0]?.acquired === true;
}

export async function releaseCollectorLock(
  client: Client,
  environment: CollectorEnvironment,
): Promise<void> {
  await client.query("SELECT pg_advisory_unlock(hashtext($1), 1)", [`${lockKeyPrefix}${environment}`]);
}
