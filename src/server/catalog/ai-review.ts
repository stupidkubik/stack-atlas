import "server-only";

import { calculateAiReadiness, type AiReadiness } from "../../domain/ai-readiness";
import type { ProductId } from "../../domain/ids";

export interface PublishedAiMapping {
  readonly productId: ProductId;
  readonly mappingKey: string;
  readonly hasComparableSdk: boolean;
}

export type AiReviewReadResult =
  | { readonly status: "available"; readonly values: readonly AiReadiness[] }
  | { readonly status: "unavailable" };

/** Calculates readiness only from published reviews and the current validated mapping. */
export function buildPublishedAiReadiness(input: {
  readonly mappings: readonly PublishedAiMapping[];
  readonly publishedReviews: readonly unknown[];
  readonly now?: Date;
}): readonly AiReadiness[] {
  const now = input.now ?? new Date();
  const reviewsByProduct = new Map<string, unknown>();
  for (const review of input.publishedReviews) {
    if (!review || typeof review !== "object" || Array.isArray(review)) continue;
    const productId = (review as Record<string, unknown>).productId;
    if (typeof productId === "string" && !reviewsByProduct.has(productId)) reviewsByProduct.set(productId, review);
  }
  return input.mappings.map((mapping) => calculateAiReadiness({
      productId: mapping.productId,
      currentMappingKey: mapping.mappingKey,
      hasComparableSdk: mapping.hasComparableSdk,
      publishedReview: reviewsByProduct.get(mapping.productId),
      now,
    }));
}

export async function readPublishedAiReadiness(input: {
  readonly readMappings: () => Promise<{ readonly ok: true; readonly value: readonly PublishedAiMapping[] } | { readonly ok: false }>;
  readonly readReviews: () => Promise<{ readonly ok: true; readonly value: readonly unknown[] } | { readonly ok: false }>;
  readonly now?: Date;
}): Promise<AiReviewReadResult> {
  try {
    const [mappings, reviews] = await Promise.all([input.readMappings(), input.readReviews()]);
    if (!mappings.ok || !reviews.ok) return { status: "unavailable" };
    return { status: "available", values: buildPublishedAiReadiness({
      mappings: mappings.value,
      publishedReviews: reviews.value,
      now: input.now,
    }) };
  } catch {
    return { status: "unavailable" };
  }
}
