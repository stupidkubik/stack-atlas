import type { PublicationReadinessInput } from "../../src/domain/publication-readiness";

export const publicationReadinessFixtures = {
  livePublished: {
    source: "live",
    entity: "published",
    content: "published",
  },
  cachedPublished: {
    source: "valid_cache",
    entity: "published",
    content: "published",
  },
  draft: {
    source: "live",
    entity: "draft",
    content: "draft",
  },
  incomplete: {
    source: "live",
    entity: "published",
    content: "incomplete",
  },
  missingLocale: {
    source: "live",
    entity: "published",
    content: "missing",
  },
  missingSlug: {
    source: "live",
    entity: "missing",
    content: "missing",
  },
  cmsUnavailable: {
    source: "unavailable",
    entity: "missing",
    content: "missing",
  },
  nonIndexableComparison: {
    source: "live",
    entity: "published",
    content: "published",
    indexingRequested: false,
  },
} as const satisfies Record<string, PublicationReadinessInput>;
