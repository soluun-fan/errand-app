import { afterAll, beforeAll, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, createTestDb } from "./pg";

let db: PGlite;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.close();
});

it("migrates existing category timing defaults", async () => {
  const { rows } = await db.query(
    "select category, default_minutes, check_hours from category_settings where category in ('dayjob', 'plumbing') order by category::text",
  );
  expect(rows).toEqual([
    { category: "dayjob", default_minutes: 240, check_hours: null },
    { category: "plumbing", default_minutes: 60, check_hours: 72 },
  ]);
});

it.each(["default_minutes = 15", "default_minutes = 500", "check_hours = 1", "check_hours = 169"])(
  "rejects invalid category timing: %s",
  async (assignment) => {
    await expect(db.exec(`update category_settings set ${assignment} where category = 'plumbing'`)).rejects.toThrow();
  },
);

it("only allows the server role to change category timing", async () => {
  await expect(
    as(db, "authenticated", null, (tx) => tx.exec("update category_settings set default_minutes = 90 where category = 'plumbing'")),
  ).rejects.toThrow();
  await as(db, "service_role", null, (tx) =>
    tx.exec("update category_settings set default_minutes = 90, check_hours = 48 where category = 'plumbing'"),
  );
  const { rows } = await db.query("select default_minutes, check_hours from category_settings where category = 'plumbing'");
  expect(rows).toEqual([{ default_minutes: 90, check_hours: 48 }]);
});
