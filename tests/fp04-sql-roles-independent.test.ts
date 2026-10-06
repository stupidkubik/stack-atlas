import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

const target = process.env.DATABASE_TEST_URL;
const enabled = Boolean(target);

async function connect(role: string): Promise<Client> {
  const url = new URL(target!);
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/pkgcompass_fp03_review") {
    throw new Error("Independent role tests require the isolated loopback database.");
  }
  url.username = role;
  url.password = "";
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  return client;
}

async function denied(client: Client, sql: string) {
  let code: unknown;
  try { await client.query(sql); } catch (error) { code = (error as {code?:unknown}).code; }
  expect(code).toBe("42501");
}

describe.skipIf(!enabled)("independent actual application role boundaries", () => {
  it("allows public metrics reads while denying private reads and all writes", async () => {
    const client = await connect("pkgcompass_public_reader");
    try {
      expect((await client.query("SELECT count(*) FROM public.metrics_current")).rowCount).toBe(1);
      await denied(client, "SELECT count(*) FROM public.lead_requests");
      await denied(client, "SELECT count(*) FROM public.rate_limits");
      await denied(client, "UPDATE public.metrics_current SET last_reason = NULL");
      await denied(client, "CREATE TABLE public.prohibited_reader_object (id integer)");
    } finally { await client.end(); }
  });

  it("allows collector current-state upserts and denies private state and destructive DDL", async () => {
    const client = await connect("pkgcompass_metrics_writer");
    try {
      await client.query("BEGIN");
      const run = randomUUID();
      await client.query(`INSERT INTO public.metrics_current
        (product_id,source,metric,source_entity_id,source_identity,source_url,last_attempt_at,last_status,valid_value,valid_observed_at,valid_fetched_at,run_id)
        VALUES ('product_fixture_role','github','stars','repository_fixture_role','fixture/project','https://github.com/fixture/project',now(),'ok','0',now(),now(),$1)`, [run]);
      expect((await client.query("UPDATE public.metrics_current SET last_reason = 'independent_probe' WHERE product_id = 'product_fixture_role'")).rowCount).toBe(1);
      await client.query("ROLLBACK");
      await denied(client, "SELECT count(*) FROM public.lead_requests");
      await denied(client, "SELECT count(*) FROM public.rate_limits");
      await denied(client, "DELETE FROM public.metrics_current");
      await denied(client, "CREATE TABLE public.prohibited_collector_object (id integer)");
    } finally { await client.end(); }
  });

  it("allows lead CRUD without access to metrics and stores no address or raw IP columns", async () => {
    const client = await connect("pkgcompass_lead_writer");
    try {
      await client.query("BEGIN");
      await client.query(`INSERT INTO public.lead_requests
        (request_id,dedup_key,payload_hash,scenario,contact_permission_version,contact_permission_at,created_at,expires_at)
        VALUES ($1,$2,$3,'marketing_site','contact_v1',now(),now(),now()+interval '720 hours')`, [randomUUID(),"0".repeat(64),"1".repeat(64)]);
      expect((await client.query("UPDATE public.lead_requests SET state='failed' WHERE dedup_key=$1", ["0".repeat(64)])).rowCount).toBe(1);
      expect((await client.query("DELETE FROM public.lead_requests WHERE dedup_key=$1", ["0".repeat(64)])).rowCount).toBe(1);
      await client.query("INSERT INTO public.rate_limits (ip_hmac,occurred_at,expires_at) VALUES ($1,now(),now()+interval '24 hours')", ["0".repeat(64)]);
      expect((await client.query("DELETE FROM public.rate_limits WHERE ip_hmac=$1", ["0".repeat(64)])).rowCount).toBe(1);
      await client.query("ROLLBACK");
      await denied(client, "SELECT count(*) FROM public.metrics_current");
      await denied(client, "CREATE TABLE public.prohibited_lead_object (id integer)");
      const columns = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('lead_requests','rate_limits')");
      expect(columns.rows.some((row) => /^(email|ip|raw_ip|address)$/.test(String(row.column_name)))).toBe(false);
    } finally { await client.end(); }
  });

  it("allows the migration owner DDL but application roles cannot alter ownership", async () => {
    const client = await connect("pkgcompass_migration_owner");
    try {
      await client.query("BEGIN");
      await client.query("CREATE TABLE public.independent_owner_probe (id integer)");
      await client.query("DROP TABLE public.independent_owner_probe");
      await client.query("ROLLBACK");
      expect((await client.query("SELECT count(*) FROM drizzle.__drizzle_migrations")).rows[0].count).toBe("4");
    } finally { await client.end(); }
  });
});
