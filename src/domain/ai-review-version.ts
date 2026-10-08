import { denseDataArray, plainDataRecord } from "./safe-objects";

/** A review may declare one SDK version; conflicting evidence cannot define a mapping. */
export function readAiSdkVersion(input: unknown): string | null | undefined {
  if (input === undefined || input === null) return null;
  const review = plainDataRecord(input);
  const signals = review && denseDataArray(review.signals);
  if (!signals) return undefined;
  const types = signals.map(plainDataRecord).filter((signal) => signal?.key === "types");
  if (types.length !== 1) return undefined;
  if (types[0]?.evidence == null && ["unknown", "error", "not_applicable"].includes(String(types[0]?.state))) return null;
  const evidence = denseDataArray(types[0]?.evidence);
  if (!evidence) return undefined;
  const versions: string[] = [];
  for (const entry of evidence) {
    const value = plainDataRecord(entry)?.packageVersion;
    if (value === undefined) continue;
    if (typeof value !== "string" || !value.length || value.trim() !== value) return undefined;
    versions.push(value);
  }
  const distinct = [...new Set(versions)];
  return distinct.length > 1 ? undefined : distinct[0] ?? null;
}
