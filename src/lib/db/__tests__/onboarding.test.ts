import { type PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createTestDb, sqlError } from "./pg";

/** Registration and terms (migration 20261118080000). */
const userId = "00000000-0000-4000-8000-000000000051";
let db: PGlite;
const svc = (sql: string, params: unknown[] = []) => as(db, "service_role", null, (tx) => tx.query(sql, params));

beforeAll(async () => {
  db = await createTestDb();
  await db.query("insert into auth.users (id, phone) values ($1, '97688400051')", [userId]);
});
afterAll(async () => {
  await db?.close();
});

describe("registration", () => {
  it("the database refuses anyone under 18 and odd dates", async () => {
    const young = await sqlError(svc("update public.profiles set birth_date = current_date - interval '17 years' where id = $1", [userId]));
    expect(young.message).toMatch(/18 or older/);
    expect((await sqlError(svc("update public.profiles set birth_date = '1850-01-01' where id = $1", [userId]))).message).toMatch(/18 or older/);
    await svc("update public.profiles set birth_date = '1995-06-01' where id = $1", [userId]);
  });

  it("keeps every acceptance with its version, once; versions have a fixed shape; server-only", async () => {
    await svc("insert into public.legal_acceptances (user_id, document, version) values ($1, 'terms', '2026-11-18')", [userId]);
    expect((await sqlError(svc("insert into public.legal_acceptances (user_id, document, version) values ($1, 'terms', '2026-11-18')", [userId]))).message).toMatch(/duplicate key/);
    expect((await sqlError(svc("insert into public.legal_acceptances (user_id, document, version) values ($1, 'cookies', '2026-11-18')", [userId]))).message).toMatch(/check constraint/);
    expect((await sqlError(svc("update public.profiles set terms_version = 'latest' where id = $1", [userId]))).message).toMatch(/check constraint/);
    const e = await sqlError(as(db, "authenticated", userId, (tx) => tx.query("select * from public.legal_acceptances")));
    expect(e.message).toMatch(/permission denied/);
  });
});
