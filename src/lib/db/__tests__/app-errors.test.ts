import { type PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createTestDb, sqlError } from "./pg";

/** Error log (migration 20261118070000): grouped, alerts at most hourly, reopens when it comes back. */
let db: PGlite;
const svc = (sql: string, params: unknown[] = []) => as(db, "service_role", null, (tx) => tx.query(sql, params));
const record = async (fp: string) =>
  ((await svc("select public.record_app_error($1, 'server', '/tasks/:id', 'boom', null) as alert", [fp])).rows[0] as { alert: boolean }).alert;

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.close();
});

describe("error log", () => {
  it("alerts once for a new kind, then at most hourly; counts every occurrence", async () => {
    expect(await record("aaaaaaaaaaaaaaaa")).toBe(true);
    expect(await record("aaaaaaaaaaaaaaaa")).toBe(false);
    expect(await record("aaaaaaaaaaaaaaaa")).toBe(false);
    expect(((await svc("select count from public.app_errors where fingerprint = 'aaaaaaaaaaaaaaaa'")).rows[0] as { count: number }).count).toBe(3);
    await svc("update public.app_errors set alerted_at = now() - interval '2 hours' where fingerprint = 'aaaaaaaaaaaaaaaa'");
    expect(await record("aaaaaaaaaaaaaaaa")).toBe(true);
  });

  it("marked fixed, it reopens and alerts again if it happens again", async () => {
    await svc("update public.app_errors set resolved_at = now() where fingerprint = 'aaaaaaaaaaaaaaaa'");
    expect(await record("aaaaaaaaaaaaaaaa")).toBe(true);
    expect(((await svc("select resolved_at from public.app_errors where fingerprint = 'aaaaaaaaaaaaaaaa'")).rows[0] as { resolved_at: string | null }).resolved_at).toBeNull();
  });

  it("is server-only, and odd fingerprints are refused", async () => {
    const e = await sqlError(as(db, "authenticated", null, (tx) => tx.query("select * from public.app_errors")));
    expect(e.message).toMatch(/permission denied/);
    expect((await sqlError(svc("select public.record_app_error('../x', 'server', '/', 'm', null)"))).message).toMatch(/check constraint/);
  });
});
