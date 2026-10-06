/**
 * The single public visibility decision used by routes, related links and sitemap
 * projections. A public candidate must have both a published common entity and a
 * complete published English document. Drafts, missing locales and incomplete
 * direct-API publications are indistinguishable to public visitors.
 */
export type PublicationSourceState = "live" | "valid_cache" | "unavailable";
export type PublicationEntityState = "published" | "draft" | "missing" | "incomplete";
export type PublicationContentState = "published" | "draft" | "missing" | "incomplete";

export interface PublicationReadinessInput {
  readonly source: PublicationSourceState;
  readonly entity: PublicationEntityState;
  readonly content: PublicationContentState;
  /** Complete comparisons may opt out of indexing while remaining viewable. */
  readonly indexingRequested?: boolean;
}

export type PublicationReadiness =
  | {
      readonly status: 200;
      readonly source: "live" | "valid_cache";
      readonly indexable: boolean;
    }
  | { readonly status: 404 }
  | { readonly status: 503 };

export function resolvePublicationReadiness(
  input: PublicationReadinessInput,
): PublicationReadiness {
  if (input.source === "unavailable") return { status: 503 };
  if (input.entity !== "published" || input.content !== "published") {
    return { status: 404 };
  }

  return {
    status: 200,
    source: input.source,
    indexable: input.indexingRequested !== false,
  };
}
