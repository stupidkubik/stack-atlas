export type ComparisonVisitConsent = "unknown" | "denied" | "granted";

export interface ComparisonVisitDecision {
  readonly lastVisitedId: string;
  readonly emitViewEvent: boolean;
}

/** Records each route visit once; a later consent change cannot replay that visit. */
export function enterComparisonVisit(
  lastVisitedId: string | undefined,
  comparisonId: string,
  consent: ComparisonVisitConsent,
): ComparisonVisitDecision {
  if (lastVisitedId === comparisonId) return { lastVisitedId: comparisonId, emitViewEvent: false };
  return { lastVisitedId: comparisonId, emitViewEvent: consent === "granted" };
}
