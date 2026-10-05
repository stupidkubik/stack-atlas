type Brand<Value, Name extends string> = Value & { readonly __brand: Name };

export type ProductId = Brand<string, "ProductId">;
export type PackageId = Brand<string, "PackageId">;
export type RepositoryId = Brand<string, "RepositoryId">;
export type CategoryId = Brand<string, "CategoryId">;
export type ComparisonId = Brand<string, "ComparisonId">;
export type EventId = Brand<string, "EventId">;
export type ConversionId = Brand<string, "ConversionId">;
export type PairKey = Brand<string, "PairKey">;

function isEntityId(value: unknown, prefix: string): value is string {
  return typeof value === "string" && new RegExp(`^${prefix}[a-z0-9_]+$`).test(value);
}

function entityId<Name extends string>(value: string, prefix: string): Brand<string, Name> {
  if (!isEntityId(value, prefix)) {
    throw new Error("Invalid entity ID.");
  }

  return value as Brand<string, Name>;
}

const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isProductId = (value: unknown): value is ProductId => isEntityId(value, "prd_");
export const isPackageId = (value: unknown): value is PackageId => isEntityId(value, "pkg_");
export const isRepositoryId = (value: unknown): value is RepositoryId => isEntityId(value, "repo_");
export const isCategoryId = (value: unknown): value is CategoryId => isEntityId(value, "cat_");
export const isComparisonId = (value: unknown): value is ComparisonId => isEntityId(value, "cmp_");
export const isEventId = (value: unknown): value is EventId =>
  typeof value === "string" && uuidV4Pattern.test(value);
export const isConversionId = (value: unknown): value is ConversionId =>
  typeof value === "string" && uuidV4Pattern.test(value);

export const productId = (value: string): ProductId =>
  entityId<"ProductId">(value, "prd_");
export const packageId = (value: string): PackageId =>
  entityId<"PackageId">(value, "pkg_");
export const repositoryId = (value: string): RepositoryId =>
  entityId<"RepositoryId">(value, "repo_");
export const categoryId = (value: string): CategoryId =>
  entityId<"CategoryId">(value, "cat_");
export const comparisonId = (value: string): ComparisonId =>
  entityId<"ComparisonId">(value, "cmp_");

export function eventId(value: string): EventId {
  if (!isEventId(value)) {
    throw new Error("Invalid event ID.");
  }

  return value as EventId;
}

export function conversionId(value: string): ConversionId {
  if (!isConversionId(value)) {
    throw new Error("Invalid conversion ID.");
  }

  return value as ConversionId;
}

export function isPairKey(value: unknown): value is PairKey {
  if (typeof value !== "string") return false;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length !== 2 || !parsed.every(isProductId)) return false;
    return parsed[0] < parsed[1] && JSON.stringify(parsed) === value;
  } catch {
    return false;
  }
}

export function pairKey(productIds: readonly [ProductId, ProductId]): PairKey {
  if (productIds[0] === productIds[1]) {
    throw new Error("A comparison requires two distinct products.");
  }

  return JSON.stringify([...productIds].sort()) as PairKey;
}
