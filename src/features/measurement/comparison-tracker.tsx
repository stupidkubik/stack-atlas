"use client";

import { useEffect, useRef } from "react";
import { getConsentState, hydrateConsentFromCookie } from "./consent-store";
import { enterComparisonVisit } from "./comparison-visit";
import { trackComparisonViewed, setMeasurementCatalogAllowlist } from "./posthog-client";

export interface ComparisonMeasurementProps {
  readonly comparisonId: string;
  readonly productIds: readonly string[];
}

/** Emits a comparison-view event only for the current visit after optional analytics consent. */
export function ComparisonMeasurement({ comparisonId, productIds }: ComparisonMeasurementProps) {
  const trackedId = useRef<string | undefined>(undefined);

  useEffect(() => {
    setMeasurementCatalogAllowlist({
      productIds,
      comparisonIds: [comparisonId],
      categoryIds: [],
    });
    hydrateConsentFromCookie();
    const visit = enterComparisonVisit(trackedId.current, comparisonId, getConsentState());
    trackedId.current = visit.lastVisitedId;
    if (!visit.emitViewEvent) return;
    trackComparisonViewed(comparisonId);
  }, [comparisonId, productIds]);

  return null;
}
