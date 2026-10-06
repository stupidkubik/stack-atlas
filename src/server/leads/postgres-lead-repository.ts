import "server-only";

import type { Pool, PoolClient } from "pg";
import type {
  LeadReservation,
  LeadReservationInput,
  LeadRepository,
} from "../../domain/lead-ports";

const maxHits = 5;
const hitTtlMs = 24 * 60 * 60 * 1000;

function plusMilliseconds(timestamp: string, milliseconds: number): string {
  const value = new Date(Date.parse(timestamp) + milliseconds);
  if (!Number.isFinite(value.getTime())) throw new Error("invalid_timestamp");
  return value.toISOString();
}

function isHash(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

function validateReservation(input: LeadReservationInput): void {
  if (
    !isHash(input.dedupKey) || !isHash(input.payloadHash) ||
    !/^[0-9a-f-]{36}$/i.test(input.requestId) ||
    plusMilliseconds(input.now, 30 * 24 * 60 * 60 * 1000) !== input.expiresAt
  ) throw new Error("invalid_reservation");
}

/** PostgreSQL persistence for HMAC-only request state and atomic rate limiting. */
export class PostgresLeadRepository implements LeadRepository {
  constructor(private readonly pool: Pool) {}

  async consumeRateLimit(ipHmac: string, now: string): Promise<boolean> {
    if (!isHash(ipHmac)) throw new Error("invalid_rate_limit_key");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
        ["pkgcompass:rate-limits", ipHmac],
      );
      const result = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM public.rate_limits
         WHERE ip_hmac = $1
           AND occurred_at > $2::timestamptz - interval '10 minutes'
           AND expires_at > $2::timestamptz`,
        [ipHmac, now],
      );
      if (Number(result.rows[0]?.count ?? 0) >= maxHits) {
        await client.query("COMMIT");
        return false;
      }
      await client.query(
        `INSERT INTO public.rate_limits (ip_hmac, occurred_at, expires_at)
         VALUES ($1, $2::timestamptz, $3::timestamptz)`,
        [ipHmac, now, plusMilliseconds(now, hitTtlMs)],
      );
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async reserve(input: LeadReservationInput): Promise<LeadReservation> {
    validateReservation(input);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query<{
        payload_hash: string;
        state: string;
        conversion_id: string;
      }>(
        `SELECT payload_hash, state, conversion_id
         FROM public.lead_requests
         WHERE request_id = $1::uuid
         FOR UPDATE`,
        [input.requestId],
      );
      if (existing.rows[0]) {
        const row = existing.rows[0];
        if (row.payload_hash !== input.payloadHash) {
          await client.query("COMMIT");
          return { kind: "conflict" };
        }
        if (row.state === "accepted") {
          await client.query("COMMIT");
          return { kind: "accepted", conversionId: row.conversion_id };
        }
        const duplicate = await this.hasAcceptedDedup(client, input.dedupKey, input.requestId);
        if (duplicate) {
          await client.query(
            `UPDATE public.lead_requests
             SET state = 'failed', updated_at = $2::timestamptz
             WHERE request_id = $1::uuid AND state <> 'accepted'`,
            [input.requestId, input.now],
          );
          await client.query("COMMIT");
          return { kind: "duplicate" };
        }
        await client.query(
          `UPDATE public.lead_requests
           SET state = 'pending', updated_at = $2::timestamptz
           WHERE request_id = $1::uuid AND state <> 'accepted'`,
          [input.requestId, input.now],
        );
        await client.query("COMMIT");
        return { kind: "continue", conversionId: row.conversion_id };
      }

      if (await this.hasAcceptedDedup(client, input.dedupKey)) {
        await client.query("COMMIT");
        return { kind: "duplicate" };
      }

      const inserted = await client.query<{ conversion_id: string }>(
        `INSERT INTO public.lead_requests (
           request_id, dedup_key, payload_hash, scenario,
           contact_permission_version, contact_permission_at,
           conversion_id, state, created_at, updated_at, expires_at
         ) VALUES (
           $1::uuid, $2, $3, $4, $5, $6::timestamptz,
           $7::uuid, 'pending', $8::timestamptz, $8::timestamptz, $9::timestamptz
         )
         ON CONFLICT (request_id) DO NOTHING
         RETURNING conversion_id`,
        [
          input.requestId,
          input.dedupKey,
          input.payloadHash,
          input.scenario,
          input.contactPermissionVersion,
          input.contactPermissionAt,
          input.conversionId,
          input.now,
          input.expiresAt,
        ],
      );
      if (inserted.rows[0]) {
        await client.query("COMMIT");
        return { kind: "continue", conversionId: inserted.rows[0].conversion_id };
      }

      // A concurrent request with the same requestId inserted while this transaction waited.
      const raced = await client.query<{
        payload_hash: string;
        state: string;
        conversion_id: string;
      }>(
        `SELECT payload_hash, state, conversion_id
         FROM public.lead_requests
         WHERE request_id = $1::uuid
         FOR UPDATE`,
        [input.requestId],
      );
      const row = raced.rows[0];
      if (!row) throw new Error("reservation_insert_lost");
      if (row.payload_hash !== input.payloadHash) {
        await client.query("COMMIT");
        return { kind: "conflict" };
      }
      if (row.state === "accepted") {
        await client.query("COMMIT");
        return { kind: "accepted", conversionId: row.conversion_id };
      }
      await client.query("COMMIT");
      return { kind: "continue", conversionId: row.conversion_id };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async hasAcceptedDedup(
    client: PoolClient,
    dedupKey: string,
    excludeRequestId?: string,
  ): Promise<boolean> {
    const result = await client.query(
      `SELECT 1
       FROM public.lead_requests
       WHERE dedup_key = $1
         AND state = 'accepted'
         AND ($2::uuid IS NULL OR request_id <> $2::uuid)
       LIMIT 1`,
      [dedupKey, excludeRequestId ?? null],
    );
    return result.rows.length > 0;
  }

  async markAccepted(requestId: string, now: string): Promise<"accepted" | "duplicate"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      try {
        const updated = await client.query(
          `UPDATE public.lead_requests
           SET state = 'accepted', updated_at = $2::timestamptz
           WHERE request_id = $1::uuid AND state <> 'accepted'
           RETURNING request_id`,
          [requestId, now],
        );
        if (updated.rows.length > 0) {
          await client.query("COMMIT");
          return "accepted";
        }
        const existing = await client.query(
          `SELECT 1 FROM public.lead_requests
           WHERE request_id = $1::uuid AND state = 'accepted'`,
          [requestId],
        );
        await client.query("COMMIT");
        if (existing.rows.length > 0) return "accepted";
        throw new Error("reservation_missing");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        if ((error as { code?: unknown })?.code !== "23505") throw error;
      }
    } finally {
      client.release();
    }

    await this.pool.query(
      `UPDATE public.lead_requests
       SET state = 'failed', updated_at = $2::timestamptz
       WHERE request_id = $1::uuid AND state <> 'accepted'`,
      [requestId, now],
    );
    return "duplicate";
  }

  async markFailed(requestId: string, now: string): Promise<void> {
    await this.pool.query(
      `UPDATE public.lead_requests
       SET state = 'failed', updated_at = $2::timestamptz
       WHERE request_id = $1::uuid AND state <> 'accepted'`,
      [requestId, now],
    );
  }
}
