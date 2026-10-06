import "server-only";

import type { CrmContacts } from "../../domain/ports";
import type { EnvironmentSource } from "../config/environment";
import { selectComponentTarget } from "../config/targets";
import { createFixtureAdapters } from "../adapters/fakes";
import { fixtureCatalogIdAllowlist } from "../fixtures/catalog";
import { createBrevoContacts, type BrevoContactsOptions } from "./brevo-contacts";

/** Selects the CRM adapter from the already validated environment boundary. */
export function createCrmContacts(
  source: EnvironmentSource = process.env,
  options: BrevoContactsOptions = {},
): CrmContacts {
  const target = selectComponentTarget("crm", source);
  if (target.mode === "fixture") {
    return createFixtureAdapters(fixtureCatalogIdAllowlist).crm;
  }
  return createBrevoContacts(target, options);
}

export { createBrevoContacts } from "./brevo-contacts";
export type { BrevoContactsOptions } from "./brevo-contacts";
