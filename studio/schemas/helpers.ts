type UnknownRecord = Record<string, unknown>;

export function asRecord(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined;
}

export function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") &&
      Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function getReferenceId(value: unknown): string | undefined {
  const record = asRecord(value);
  return record && typeof record._ref === "string" ? record._ref : undefined;
}

export function uniqueReferences(value: unknown): true | string {
  if (!Array.isArray(value)) return true;
  const ids = value.map(getReferenceId).filter((id): id is string => Boolean(id));
  return ids.length === value.length && new Set(ids).size === ids.length
    ? true
    : "References must be valid and unique.";
}

export function uniqueObjectKeys(value: unknown, name: string): true | string {
  if (!Array.isArray(value)) return true;
  const keys = value.map((item) => asRecord(item)?.key);
  return keys.every((key) => typeof key === "string" && key.trim().length > 0) &&
    new Set(keys).size === keys.length
    ? true
    : `${name} must have a non-empty, unique key on each item.`;
}

export function containsOnlyKnownSourceKeys(
  value: unknown,
  context: { readonly document?: unknown },
): true | string {
  if (!Array.isArray(value)) return true;
  const document = asRecord(context.document);
  const sources = Array.isArray(document?.sources)
    ? document.sources.map((source) => asRecord(source)?.key)
    : [];
  const keys = value.map((key) => key);
  return keys.every((key) => typeof key === "string" && sources.includes(key))
    ? true
    : "Every source key must refer to a source in this document.";
}

export function portableTextHasContent(value: unknown): boolean {
  return Array.isArray(value) && value.some((item) => {
    const block = asRecord(item);
    if (!block) return false;
    const children = Array.isArray(block.children) ? block.children : [];
    return children.some((child) => {
      const span = asRecord(child);
      return typeof span?.text === "string" && span.text.trim().length > 0;
    });
  });
}

export function slugIsValid(value: unknown): true | string {
  const slug = asRecord(value);
  return typeof slug?.current === "string" &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug.current) &&
    !slug.current.includes("-vs-")
    ? true
    : "Use a lowercase, URL-safe slug. Product slugs cannot contain -vs-.";
}

export function isCurrentUtcDateTime(value: unknown): true | string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    return "Use a valid ISO timestamp in UTC.";
  }
  return Date.parse(value) <= Date.now() + 5 * 60 * 1000
    ? true
    : "A review date cannot be in the future.";
}
