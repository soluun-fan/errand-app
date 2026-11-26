import { type PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createTestDb, sqlError } from "./pg";

/** Migration 20261126020000: helper profile extras and the customer identity check. */
const userId = "00000000-0000-4000-8000-0000000000e1";
let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await db.query("insert into auth.users (id, phone) values ($1, '99350001')", [userId]);
});
afterAll(async () => {
  await db?.close();
});

const application = (purpose: string, categories: string) =>
  db.query(
    `insert into public.helper_applications (user_id, legal_name, id_last4, birth_date, categories, consent_at, purpose)
     values ($1, 'Test Person', '1234', '1990-05-01', $2::public.category[], now(), $3)`,
    [userId, categories, purpose],
  );

it("an identity check needs no job kinds; a helper application still does", async () => {
  await application("identity", "{}");
  await db.query("delete from public.helper_applications where user_id = $1", [userId]);
  expect((await sqlError(application("helper", "{}"))).message).toMatch(/categories_check/);
  expect((await sqlError(application("anything", "{queue}"))).message).toMatch(/purpose/);
});

it("a helper may apply for every kind of work at once (no six-kind cap, 20261127040000)", async () => {
  const { CATEGORIES } = await import("@/lib/engine");
  await db.query("delete from public.helper_applications where user_id = $1", [userId]);
  await application("helper", `{${CATEGORIES.map((c) => c.id).join(",")}}`);
  await db.query("delete from public.helper_applications where user_id = $1", [userId]);
});

it("profile extras: known transport only, sensible experience, decade age bands, off by default", async () => {
  const { rows } = await db.query<{ show_age_band: boolean; transport: string[] }>("select show_age_band, transport from public.profiles where id = $1", [userId]);
  expect(rows[0]).toEqual({ show_age_band: false, transport: [] });
  await db.query("update public.profiles set transport = '{walk,car}', experience_years = 5, age_band = 30 where id = $1", [userId]);
  expect((await sqlError(db.query("update public.profiles set transport = '{helicopter}' where id = $1", [userId]))).message).toMatch(/transport/);
  expect((await sqlError(db.query("update public.profiles set experience_years = 99 where id = $1", [userId]))).message).toMatch(/experience_years/);
  expect((await sqlError(db.query("update public.profiles set age_band = 35 where id = $1", [userId]))).message).toMatch(/age_band/);
});
