import "server-only";

import { randomBytes } from "node:crypto";
import { resolveAppEnvironment, type EnvironmentSource } from "../../server/config/environment";
import { selectComponentTarget } from "../config/targets";
import { createCrmContacts } from "../crm";
import { createPooledLeadWriter } from "../db/connections";
import type { CrmContacts } from "../../domain/ports";
import type { LeadRepository } from "../../domain/lead-ports";
import { MemoryLeadRepository } from "./memory-lead-repository";
import { PostgresLeadRepository } from "./postgres-lead-repository";

export interface LeadRuntime {
  readonly environment: "fixture" | "development" | "production";
  readonly hmacSecret: string;
  readonly repository: LeadRepository;
  readonly crm: CrmContacts;
}

let runtimePromise: Promise<LeadRuntime> | undefined;
const fixtureRepository = new MemoryLeadRepository();
const fixtureHmacSecret = randomBytes(32).toString("hex");

export async function createLeadRuntime(source: EnvironmentSource = process.env): Promise<LeadRuntime> {
  const environment = resolveAppEnvironment(source);
  const security = selectComponentTarget("leadSecurity", source);
  const crm = createCrmContacts(source);
  if (environment === "fixture") {
    return {
      environment,
      hmacSecret: fixtureHmacSecret,
      repository: fixtureRepository,
      crm,
    };
  }

  if (security.mode !== "live") throw new Error("lead_security_unavailable");
  const database = createPooledLeadWriter(source);
  return {
    environment,
    hmacSecret: security.settings.LEAD_HMAC_SECRET,
    repository: new PostgresLeadRepository(database.pool),
    crm,
  };
}

/** Reuses one pool and fixture state per server process. */
export function getLeadRuntime(): Promise<LeadRuntime> {
  runtimePromise ??= createLeadRuntime().catch((error) => {
    runtimePromise = undefined;
    throw error;
  });
  return runtimePromise;
}
