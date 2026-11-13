/**
 * Test database: real Postgres (PGlite, in-process WASM) with the project's migrations
 * applied on top of minimal stand-ins for what Supabase provides (auth schema, roles).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { dealFromRow, type DealRow, type DisputeRow, type OfferRow } from "@/lib/db/mapping";
import type { Deal } from "@/lib/engine";

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

/** Just enough of Supabase for the migrations to run and RLS to be testable. */
const SUPABASE_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create role supabase_auth_admin nologin;
  create schema auth;
  grant usage on schema public, auth to anon, authenticated, service_role;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    phone text,
    raw_user_meta_data jsonb not null default '{}'
  );
  -- Supabase's auth.uid() reads the verified JWT's "sub" claim.
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`;

/** Supabase's default grants for the service role, applied after migrations. */
const SERVICE_ROLE_GRANTS = `
  grant all on all tables in schema public to service_role;
  grant usage on all sequences in schema public to service_role;
`;

export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
  }
  await db.exec(SERVICE_ROLE_GRANTS);
  return db;
}

type Q = PGlite | Transaction;

/** Run `fn` as a Supabase role (and user, for `authenticated`) inside a transaction. */
export async function as<T>(
  db: PGlite,
  role: "service_role" | "authenticated" | "anon" | "supabase_auth_admin",
  userId: string | null,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? ""]);
    await tx.exec(`set local role ${role}`);
    return fn(tx);
  });
}

/** Call a public SQL function with named jsonb/uuid/int args, like supabase.rpc(). */
export async function rpc(q: Q, fn: string, args: Record<string, unknown>): Promise<unknown> {
  const names = Object.keys(args);
  const casts = names.map((k, i) => {
    const v = args[k];
    const cast = typeof v === "number" ? "int" : typeof v === "string" ? "uuid" : "jsonb";
    return `${k} => $${i + 1}::${cast}`;
  });
  const params = names.map((k) => {
    const v = args[k];
    return v === null ? null : typeof v === "object" ? JSON.stringify(v) : v;
  });
  const res = await q.query<{ r: unknown }>(`select public.${fn}(${casts.join(", ")}) as r`, params);
  return res.rows[0]?.r;
}

/** Load a deal exactly the way the server will: rows as JSON (what PostgREST returns). */
export async function loadDeal(q: Q, id: string): Promise<Deal | null> {
  const d = await q.query<{ j: DealRow }>(`select to_jsonb(d) as j from public.deals d where id = $1`, [id]);
  if (!d.rows[0]) return null;
  const offers = await q.query<{ j: OfferRow }>(
    `select to_jsonb(o) as j from public.offers o where deal_id = $1 order by created_at`,
    [id],
  );
  const dispute = await q.query<{ j: DisputeRow }>(`select to_jsonb(x) as j from public.disputes x where deal_id = $1`, [id]);
  return dealFromRow(
    d.rows[0].j,
    offers.rows.map((r) => r.j),
    dispute.rows[0]?.j ?? null,
  );
}

export async function sqlError(p: Promise<unknown>): Promise<{ code?: string; message: string }> {
  try {
    await p;
  } catch (e) {
    return e as { code?: string; message: string };
  }
  throw new Error("expected the database to reject this");
}
