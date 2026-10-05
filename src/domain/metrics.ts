import type { PackageId, ProductId, RepositoryId } from "./ids";
import type { UtcDateTime } from "./utc";

export type MetricSource = "npm" | "github";
export type MetricAttemptStatus = "ok" | "error" | "unknown" | "not_applicable";

interface MetricSnapshotBase {
  readonly productId: ProductId;
  readonly sourceIdentity: string;
  readonly lastAttemptAt: UtcDateTime;
  readonly lastStatus: MetricAttemptStatus;
  readonly validValue: number | null;
  readonly validObservedAt: UtcDateTime | null;
  readonly validFetchedAt: UtcDateTime | null;
}

export type CurrentMetric =
  | (MetricSnapshotBase & {
      readonly source: "npm";
      readonly metric: "downloads_30d";
      readonly sourceEntityId: PackageId;
      readonly periodStart?: string;
      readonly periodEnd?: string;
      readonly dailySeries?: readonly { readonly day: string; readonly downloads: number }[];
    })
  | (MetricSnapshotBase & {
      readonly source: "github";
      readonly metric: "stars" | "open_issues";
      readonly sourceEntityId: RepositoryId;
    });
