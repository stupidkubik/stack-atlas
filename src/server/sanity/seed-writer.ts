import type { SeedDocument } from "../../domain/seed-records";

export type SeedOperation = "create" | "skip" | "conflict";
export interface SeedPlanRow {
  readonly id: string;
  readonly type: string;
  readonly operation: SeedOperation;
  readonly reason?: "id_exists" | "id_identity_mismatch" | "route_slug_exists" | "package_name_exists" | "pair_exists" | "dependency_conflict" | "write_failed";
}

export interface ExistingSeedIdentity {
  readonly id: string;
  readonly type: string;
  readonly slug?: string;
  readonly packageName?: string;
  readonly pairKey?: string;
  readonly productId?: string;
  readonly owner?: string;
  readonly name?: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function referencesIn(value: unknown, output: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) referencesIn(item, output);
    return output;
  }
  const item = record(value);
  if (!item) return output;
  if (item._type === "reference" && typeof item._ref === "string") output.add(item._ref);
  for (const child of Object.values(item)) referencesIn(child, output);
  return output;
}

function normalizeId(value: string): string { return value.startsWith("drafts.") ? value.slice("drafts.".length) : value; }

function referenceId(value: unknown): string | undefined {
  const reference = record(value);
  return typeof reference?._ref === "string" ? normalizeId(reference._ref) : undefined;
}

function uniqueIdentity(doc: SeedDocument): { readonly field: "slug" | "packageName" | "pairKey"; readonly value: string } | undefined {
  if (doc._type === "product" || doc._type === "category") {
    const slug = record(doc.routeSlug)?.current;
    return typeof slug === "string" ? { field: "slug", value: slug } : undefined;
  }
  if (doc._type === "package" && typeof doc.packageName === "string") return { field: "packageName", value: doc.packageName };
  if (doc._type === "comparison" && typeof doc.pairKey === "string") return { field: "pairKey", value: doc.pairKey };
  return undefined;
}

function identityMismatch(doc: SeedDocument, existing: readonly ExistingSeedIdentity[]): boolean {
  const expected = uniqueIdentity(doc);
  return existing.some((item) => {
    if (item.type !== doc._type) return true;
    if (expected && item[expected.field] !== expected.value) return true;
    if (doc._type === "package") return item.productId !== referenceId(doc.productId);
    if (doc._type === "repository") {
      return item.productId !== referenceId(doc.productId) || item.owner !== doc.owner || item.name !== doc.name;
    }
    return false;
  });
}

function conflictReason(doc: SeedDocument, existing: readonly ExistingSeedIdentity[]): SeedPlanRow["reason"] {
  const identity = uniqueIdentity(doc);
  if (!identity) return undefined;
  if (identity.field === "slug" && existing.some((item) => item.type === doc._type && item.slug === identity.value && normalizeId(item.id) !== doc._id)) return "route_slug_exists";
  if (identity.field === "packageName" && existing.some((item) => item.type === "package" && item.packageName === identity.value && normalizeId(item.id) !== doc._id)) return "package_name_exists";
  if (identity.field === "pairKey" && existing.some((item) => item.type === "comparison" && item.pairKey === identity.value && normalizeId(item.id) !== doc._id)) return "pair_exists";
  return undefined;
}

/** Plans only opaque identifiers and uniqueness fields; no editorial body enters the report. */
export function planSeedDocuments(input: {
  readonly documents: readonly SeedDocument[];
  readonly existing: readonly ExistingSeedIdentity[];
}): readonly SeedPlanRow[] {
  const seenIds = new Set<string>();
  const duplicateDefinition = input.documents.some((doc) => {
    if (!doc._id || !doc._type || seenIds.has(doc._id)) return true;
    seenIds.add(doc._id);
    return false;
  });
  if (duplicateDefinition) throw new Error("seed_definition_invalid");

  for (const [type, identity] of [["product", "slug"], ["category", "slug"], ["package", "packageName"], ["comparison", "pairKey"]] as const) {
    const values = input.documents.flatMap((doc) => {
      const value = identity === "slug" ? record(doc.routeSlug)?.current : doc[identity];
      return doc._type === type && typeof value === "string" ? [value] : [];
    });
    if (new Set(values).size !== values.length) throw new Error("seed_definition_identity_conflict");
  }

  const rowsById = new Map<string, SeedPlanRow>();
  for (const doc of input.documents) {
    const exactIds = input.existing.filter((item) => normalizeId(item.id) === doc._id);
    const uniqueConflict = conflictReason(doc, input.existing);
    if (uniqueConflict) rowsById.set(doc._id, { id: doc._id, type: doc._type, operation: "conflict", reason: uniqueConflict });
    else if (exactIds.length > 0 && identityMismatch(doc, exactIds)) rowsById.set(doc._id, { id: doc._id, type: doc._type, operation: "conflict", reason: "id_identity_mismatch" });
    else if (exactIds.length > 0) rowsById.set(doc._id, { id: doc._id, type: doc._type, operation: "skip", reason: "id_exists" });
    else rowsById.set(doc._id, { id: doc._id, type: doc._type, operation: "create" });
  }
  const seedIds = new Set(input.documents.map(({ _id }) => _id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const doc of input.documents) {
      const current = rowsById.get(doc._id)!;
      if (current.operation === "conflict") continue;
      const dependsOnConflict = [...referencesIn(doc)].some((id) => seedIds.has(id) && rowsById.get(id)?.operation === "conflict");
      if (dependsOnConflict) {
        rowsById.set(doc._id, { id: doc._id, type: doc._type, operation: "conflict", reason: "dependency_conflict" });
        changed = true;
      }
    }
  }
  return input.documents.map(({ _id }) => rowsById.get(_id)!);
}

export type SeedWriter = (document: SeedDocument) => Promise<void>;

export async function applySeedPlan(input: {
  readonly documents: readonly SeedDocument[];
  readonly plan: readonly SeedPlanRow[];
  readonly write: SeedWriter;
}): Promise<{ readonly rows: readonly SeedPlanRow[]; readonly failed: number }> {
  let failed = 0;
  const rows: SeedPlanRow[] = [];
  const operationById = new Map(input.plan.map((row) => [row.id, row]));
  let writeFailed = false;
  for (const doc of input.documents) {
    const plan = operationById.get(doc._id);
    if (!plan || plan.operation !== "create") { if (plan) rows.push(plan); continue; }
    if (writeFailed) {
      rows.push({ id: plan.id, type: plan.type, operation: "conflict", reason: "dependency_conflict" });
      continue;
    }
    try {
      await input.write(doc);
      rows.push(plan);
    } catch {
      failed += 1;
      writeFailed = true;
      rows.push({ id: plan.id, type: plan.type, operation: "conflict", reason: "write_failed" });
    }
  }
  return { rows, failed };
}
