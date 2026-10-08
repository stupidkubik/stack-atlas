import type { DocumentBadgeComponent } from "sanity";

export function aiReviewNeedsRefresh(input: unknown, now = new Date()): boolean {
  if (!input || typeof input !== "object") return false;
  const doc = input as { signals?: { checkedAt?: unknown }[] };
  if (!Array.isArray(doc.signals) || doc.signals.length !== 3) return false;
  const dates = doc.signals.map((signal) => typeof signal.checkedAt === "string" ? Date.parse(signal.checkedAt) : NaN);
  return dates.every(Number.isFinite) && now.getTime() - Math.min(...dates) > 75 * 24 * 60 * 60_000;
}

export const aiReviewAgeBadge: DocumentBadgeComponent = (props) => {
  if (props.type !== "aiReview" || !aiReviewNeedsRefresh(props.published)) return null;
  return { label: "Review due", title: "Published evidence is over 75 days old. Recheck its sources.", color: "warning" };
};
