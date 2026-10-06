import "server-only";

import type {
  LeadReservation,
  LeadReservationInput,
  LeadRepository,
} from "../../domain/lead-ports";

interface MemoryLeadRow {
  readonly requestId: string;
  readonly dedupKey: string;
  readonly payloadHash: string;
  readonly conversionId: string;
  state: "pending" | "accepted" | "failed";
}

/** Process-local fixture repository. It retains hashes and counts, never email or IP. */
export class MemoryLeadRepository implements LeadRepository {
  private readonly rows = new Map<string, MemoryLeadRow>();
  private readonly acceptedByDedup = new Map<string, string>();
  private readonly rateHits = new Map<string, number[]>();

  async consumeRateLimit(ipHmac: string, now: string): Promise<boolean> {
    const timestamp = Date.parse(now);
    const recent = (this.rateHits.get(ipHmac) ?? []).filter((hit) => timestamp - hit < 10 * 60 * 1000);
    if (recent.length >= 5) {
      this.rateHits.set(ipHmac, recent);
      return false;
    }
    recent.push(timestamp);
    this.rateHits.set(ipHmac, recent);
    return true;
  }

  async reserve(input: LeadReservationInput): Promise<LeadReservation> {
    const existing = this.rows.get(input.requestId);
    if (existing) {
      if (existing.payloadHash !== input.payloadHash) return { kind: "conflict" };
      if (existing.state === "accepted") return { kind: "accepted", conversionId: existing.conversionId };
      const acceptedRequest = this.acceptedByDedup.get(input.dedupKey);
      if (acceptedRequest && acceptedRequest !== input.requestId) {
        existing.state = "failed";
        return { kind: "duplicate" };
      }
      existing.state = "pending";
      return { kind: "continue", conversionId: existing.conversionId };
    }

    if (this.acceptedByDedup.has(input.dedupKey)) return { kind: "duplicate" };
    this.rows.set(input.requestId, {
      requestId: input.requestId,
      dedupKey: input.dedupKey,
      payloadHash: input.payloadHash,
      conversionId: input.conversionId,
      state: "pending",
    });
    return { kind: "continue", conversionId: input.conversionId };
  }

  async markAccepted(requestId: string): Promise<"accepted" | "duplicate"> {
    const row = this.rows.get(requestId);
    if (!row) throw new Error("reservation_missing");
    if (row.state === "accepted") return "accepted";
    const acceptedRequest = this.acceptedByDedup.get(row.dedupKey);
    if (acceptedRequest && acceptedRequest !== requestId) {
      row.state = "failed";
      return "duplicate";
    }
    row.state = "accepted";
    this.acceptedByDedup.set(row.dedupKey, requestId);
    return "accepted";
  }

  async markFailed(requestId: string): Promise<void> {
    const row = this.rows.get(requestId);
    if (row && row.state !== "accepted") row.state = "failed";
  }

  /** Test-only snapshot contains status and counters, never addresses or source IPs. */
  snapshot(): Readonly<{ rows: number; accepted: number }> {
    return {
      rows: this.rows.size,
      accepted: [...this.rows.values()].filter((row) => row.state === "accepted").length,
    };
  }
}
