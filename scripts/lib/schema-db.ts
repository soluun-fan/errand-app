/** Disposable Postgres schema shared by migration tests and database type generation. Never connects to a hosted database. */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

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
  -- Supabase Storage keeps buckets in storage.buckets.
  create schema storage;
  create table storage.buckets (
    id text primary key,
    name text not null,
    public boolean default false,
    file_size_limit bigint,
    allowed_mime_types text[]
  );
`;

/** Supabase's default grants for the service role, applied after migrations. */
const SERVICE_ROLE_GRANTS = `
  grant all on all tables in schema public to service_role;
  grant usage on all sequences in schema public to service_role;
`;

export async function createSchemaDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  for (const f of readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
  }
  await db.exec(SERVICE_ROLE_GRANTS);
  return db;
}
