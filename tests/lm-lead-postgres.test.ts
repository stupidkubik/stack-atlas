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
});
