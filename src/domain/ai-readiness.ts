import { isProductId, productId, type ProductId } from "./ids";
import { denseDataArray, plainDataRecord } from "./safe-objects";
import { isUtcDateTime, type UtcDateTime } from "./utc";

export type AiReadinessKey = "types" | "llmsTxt" | "mcp";
export type AiReadinessSignalState = "present" | "absent" | "unknown" | "error" | "not_applicable";
export type AiTypesKind = "bundled" | "external" | "none";

export interface AiReadinessEvidence {
  readonly sourceUrl: string;
  readonly officialSourceUrl?: string;
  readonly finding: string;
  readonly checkedAt: UtcDateTime;
  readonly packageVersion?: string;
  readonly entryPoints?: readonly string[];
}

export interface AiReadinessSignal {
  readonly key: AiReadinessKey;
  readonly state: AiReadinessSignalState;
  readonly scope: string;
  readonly checkedAt: UtcDateTime | null;
  readonly evidence: readonly AiReadinessEvidence[];
  readonly kind?: AiTypesKind | null;
  readonly reason?: string;
}

export interface AiReadiness {
  readonly productId: ProductId;
  readonly methodologyVersion: "cms-ai-support-v1";
  readonly mappingKey: string | null;
  readonly completeness: "complete" | "incomplete" | "not_applicable";
  readonly score: number | null;
  readonly evidenceAsOf: UtcDateTime | null;
  readonly stale: boolean;
  readonly signals: readonly [AiReadinessSignal, AiReadinessSignal, AiReadinessSignal];
}

interface ParsedReview {
  readonly productId: ProductId;
  readonly methodologyVersion: "cms-ai-support-v1";
  readonly mappingKey: string;
  readonly signals: readonly [AiReadinessSignal, AiReadinessSignal, AiReadinessSignal];
}

const signalKeys: readonly AiReadinessKey[] = ["types", "llmsTxt", "mcp"];
const maxFutureSkewMs = 5 * 60_000;
const maxReviewAgeMs = 90 * 24 * 60 * 60_000;

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function safeEvidenceUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function validReviewTime(value: unknown, now: Date): value is UtcDateTime {
  return isUtcDateTime(value) && Date.parse(value) <= now.getTime() + maxFutureSkewMs;
}

export function parsePublishedAiReview(input: unknown, now: Date): ParsedReview | undefined {
  const review = plainDataRecord(input);
  if (
    !review || !isProductId(review.productId) || review.state !== "published" ||
    review.methodologyVersion !== "cms-ai-support-v1" ||
    typeof review.mappingKey !== "string" || !/^[a-f0-9]{64}$/.test(review.mappingKey) ||
    !validReviewTime(review.reviewedAt, now)
  ) return undefined;
  const signalInputs = denseDataArray(review.signals);
  if (!signalInputs || signalInputs.length !== 3) return undefined;
  const signals = signalInputs.map((signalInput, index): AiReadinessSignal | undefined => {
    const signal = plainDataRecord(signalInput);
    const evidenceInputs = signal && denseDataArray(signal.evidence);
    if (
      !signal || !evidenceInputs || signal.key !== signalKeys[index] ||
      !["present", "absent", "unknown", "error", "not_applicable"].includes(String(signal.state)) ||
      !isNonEmpty(signal.scope) || !(signal.checkedAt === null || validReviewTime(signal.checkedAt, now))
    ) return undefined;
    const state = signal.state as AiReadinessSignalState;
    if ((state === "present" || state === "absent") && (!signal.checkedAt || evidenceInputs.length === 0)) return undefined;
    const evidence = evidenceInputs.map((entryInput): AiReadinessEvidence | undefined => {
      const entry = plainDataRecord(entryInput);
      const entryPoints = entry?.entryPoints === undefined ? undefined : denseDataArray(entry.entryPoints);
      if (
        !entry || !safeEvidenceUrl(entry.sourceUrl) || !isNonEmpty(entry.finding) ||
        !validReviewTime(entry.checkedAt, now) ||
        (entry.officialSourceUrl !== undefined && !safeEvidenceUrl(entry.officialSourceUrl)) ||
        (entry.packageVersion !== undefined && !isNonEmpty(entry.packageVersion)) ||
        (entry.entryPoints !== undefined && (!entryPoints || !entryPoints.every(isNonEmpty)))
      ) return undefined;
      return {
        sourceUrl: entry.sourceUrl,
        finding: entry.finding,
        checkedAt: entry.checkedAt,
        ...(entry.officialSourceUrl ? { officialSourceUrl: entry.officialSourceUrl } : {}),
        ...(entry.packageVersion ? { packageVersion: entry.packageVersion } : {}),
        ...(entryPoints ? { entryPoints: entryPoints as string[] } : {}),
      };
    });
    if (evidence.some((item) => item === undefined)) return undefined;

    if (signal.key === "types") {
      if (state === "present" && !["bundled", "external"].includes(String(signal.kind))) return undefined;
      if (state === "absent" && signal.kind !== "none") return undefined;
      if (!(signal.kind === undefined || signal.kind === null || ["bundled", "external", "none"].includes(String(signal.kind)))) return undefined;
    } else if (signal.kind !== undefined && signal.kind !== null) return undefined;

    const officialMissing = state === "present" && signal.key !== "types" &&
      !evidence.some((item) => item?.officialSourceUrl);
    return {
      key: signal.key as AiReadinessKey,
      state: officialMissing ? "unknown" : state,
      ...(officialMissing ? { reason: "official_evidence_missing" } : isNonEmpty(signal.reason) ? { reason: signal.reason } : {}),
      scope: signal.scope,
      checkedAt: signal.checkedAt as UtcDateTime | null,
      evidence: evidence as AiReadinessEvidence[],
      ...(signal.key === "types" && signal.kind !== undefined ? { kind: signal.kind as AiTypesKind | null } : {}),
    };
  });
  if (signals.some((signal) => signal === undefined)) return undefined;
  return {
    productId: productId(review.productId),
    methodologyVersion: "cms-ai-support-v1",
    mappingKey: review.mappingKey,
    signals: signals as [AiReadinessSignal, AiReadinessSignal, AiReadinessSignal],
  };
}

function emptySignals(
  state: "unknown" | "not_applicable",
  reason: AiReadinessSignal["reason"],
): [AiReadinessSignal, AiReadinessSignal, AiReadinessSignal] {
  const make = (key: AiReadinessKey): AiReadinessSignal => ({
    key, state, scope: "", checkedAt: null, evidence: [], reason,
    ...(key === "types" ? { kind: null } : {}),
  });
  return [make("types"), make("llmsTxt"), make("mcp")];
}

/** Validates a published review and calculates its public score without storing it in SQL. */
export function calculateAiReadiness(input: {
  readonly productId: ProductId;
  readonly currentMappingKey: string;
  readonly hasComparableSdk: boolean;
  readonly publishedReview: unknown;
  readonly now?: Date;
}): AiReadiness {
  const now = input.now ?? new Date();
  const base = {
    productId: input.productId,
    methodologyVersion: "cms-ai-support-v1" as const,
    mappingKey: null as string | null,
    score: null as number | null,
    evidenceAsOf: null as UtcDateTime | null,
    stale: false,
  };
  if (!input.hasComparableSdk) {
    return { ...base, completeness: "not_applicable", signals: emptySignals("not_applicable", "no_comparable_sdk") };
  }

  const review = parsePublishedAiReview(input.publishedReview, now);
  if (!review || review.productId !== input.productId) {
    return { ...base, completeness: "incomplete", signals: emptySignals("unknown", "review_missing") };
  }
  if (review.mappingKey !== input.currentMappingKey) {
    return { ...base, signals: emptySignals("unknown", "mapping_changed"), completeness: "incomplete" };
  }

  const complete = review.signals.every((signal) => signal.state === "present" || signal.state === "absent");
  if (!complete) {
    return { ...base, mappingKey: review.mappingKey, completeness: "incomplete", signals: review.signals };
  }
  const typeSignal = review.signals[0];
  const types = typeSignal.kind === "bundled" ? 1 : typeSignal.kind === "external" ? 0.5 : 0;
  const llmsTxt = review.signals[1].state === "present" ? 1 : 0;
  const mcp = review.signals[2].state === "present" ? 1 : 0;
  const score = Math.floor((100 * (25 * types + 20 * llmsTxt + 20 * mcp)) / 65 + 0.5);
  const signalDates = review.signals.map((signal) => Date.parse(signal.checkedAt as UtcDateTime));
  const evidenceAsOf = new Date(Math.min(...signalDates)).toISOString() as UtcDateTime;
  return {
    ...base,
    mappingKey: review.mappingKey,
    completeness: "complete",
    score,
    evidenceAsOf,
    stale: now.getTime() - Date.parse(evidenceAsOf) > maxReviewAgeMs,
    signals: review.signals,
  };
}
