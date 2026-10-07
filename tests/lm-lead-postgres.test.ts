import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { PostgresLeadRepository } from "../src/server/leads/postgres-lead-repository";

const target = process.env.DATABASE_TEST_URL;
let safeLoopbackTarget = false;
if (target) {
  try {
    const parsed = new URL(target);
    safeLoopbackTarget = ["postgres:", "postgresql:"].includes(parsed.protocol) &&
      parsed.hostname === "127.0.0.1" && parsed.port === "55437" &&
      parsed.username === "fixture_admin" && parsed.pathname === "/pkgcompass_fp03_review" &&
      parsed.search === "" && parsed.hash === "";
  } catch { safeLoopbackTarget = false; }
  if (!safeLoopbackTarget) throw new Error("Lead PostgreSQL test requires the isolated loopback review database.");
}

describe.skipIf(!safeLoopbackTarget)("PostgreSQL lead rate limit", () => {
  it("atomically rejects the sixth concurrent hit for one HMAC key", async () => {
    const pool = new Pool({ connectionString: target, application_name: "pkgcompass-lm-rate-limit-test", max: 8 });
    const repository = new PostgresLeadRepository(pool);
    const ipHmac = createHash("sha256").update(randomUUID()).digest("hex");
    const now = "2026-10-06T07:30:00.000Z";
    try {
      const outcomes = await Promise.all(Array.from(
        { length: 6 },
        () => repository.consumeRateLimit(ipHmac, now),
      ));
      expect(outcomes.filter(Boolean)).toHaveLength(5);
      expect(outcomes.filter((accepted) => !accepted)).toHaveLength(1);
    } finally {
      await pool.query("DELETE FROM public.rate_limits WHERE ip_hmac = $1", [ipHmac]).catch(() => undefined);
      await pool.end();
    }
  });

  it("keeps accepted terminal after a late failure and returns its conversion on retry", async () => {
    const pool = new Pool({ connectionString: target, application_name: "pkgcompass-lm-accepted-terminal-test", max: 2 });
    const repository = new PostgresLeadRepository(pool);
    const requestId = randomUUID();
    const conversionId = randomUUID();
    const dedupKey = createHash("sha256").update(randomUUID()).digest("hex");
    const payloadHash = createHash("sha256").update(randomUUID()).digest("hex");
    const now = "2026-10-06T07:30:00.000Z";
    const later = "2026-10-06T07:31:00.000Z";
    const expiresAt = new Date(Date.parse(now) + 30 * 24 * 60 * 60 * 1000).toISOString();
    const laterExpiresAt = new Date(Date.parse(later) + 30 * 24 * 60 * 60 * 1000).toISOString();
    const input = {
      requestId,
      dedupKey,
      payloadHash,
      scenario: "marketing_site" as const,
      contactPermissionVersion: "contact_v1" as const,
      contactPermissionAt: now,
      conversionId,
      now,
      expiresAt,
    };

    try {
      const reservation = await repository.reserve(input);
      expect(reservation).toEqual({ kind: "continue", conversionId });
      await expect(repository.markAccepted(requestId, now)).resolves.toBe("accepted");
      await repository.markFailed(requestId, later);

      const retry = await repository.reserve({ ...input, now: later, expiresAt: laterExpiresAt });
      expect(retry).toEqual({ kind: "accepted", conversionId });
      const row = await pool.query<{ state: string; conversion_id: string }>(
        `SELECT state, conversion_id FROM public.lead_requests WHERE request_id = $1::uuid`,
        [requestId],
      );
      expect(row.rows).toEqual([{ state: "accepted", conversion_id: conversionId }]);
    } finally {
      await pool.query("DELETE FROM public.lead_requests WHERE request_id = $1::uuid", [requestId]).catch(() => undefined);
      await pool.end();
    }
  });
});
