import { type PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { insertDealArgs } from "@/lib/db/mapping";
import { createErrand } from "@/lib/engine";
import { as, createTestDb, rpc, sqlError } from "./pg";

/** More photos (migration 20261117030000): start / progress proofs and the customer's task photos. */
const customerId = "00000000-0000-4000-8000-000000000011";
const otherId = "00000000-0000-4000-8000-000000000012";
let db: PGlite;
let dealId = "";

const svc = (sql: string, params: unknown[] = []) => as(db, "service_role", null, (tx) => tx.query(sql, params));
const path = (user: string) => `u/${user}/${crypto.randomUUID()}.jpg`;

beforeAll(async () => {
  db = await createTestDb();
  for (const id of [customerId, otherId]) await db.query("insert into auth.users (id, phone) values ($1, $2)", [id, `97688000${id.slice(-2)}`]);
  const t = createErrand(
    { id: crypto.randomUUID(), title: "Buy bread", description: "x", category: "shop", mode: "now", address: "Test", customerId, fee: 10_000, itemBudget: 0 },
    { now: Date.now(), actor: { kind: "user", id: customerId, role: "customer" } },
  );
  await as(db, "service_role", null, (tx) => rpc(tx, "insert_deal", insertDealArgs(t)));
  dealId = t.deal.id;
});
afterAll(async () => {
  await db?.close();
});

describe("start and progress proofs", () => {
  it("accepts the new kinds and a short note; refuses a note over 140 characters", async () => {
    await svc(`insert into public.proofs (deal_id, kind, uploaded_by) values ($1, 'start', $2)`, [dealId, customerId]);
    await svc(`insert into public.proofs (deal_id, kind, note, uploaded_by) values ($1, 'progress', 'picked up', $2)`, [dealId, customerId]);
    const bad = await sqlError(svc(`insert into public.proofs (deal_id, kind, note, uploaded_by) values ($1, 'progress', $2, $3)`, [dealId, "x".repeat(141), customerId]));
    expect(bad.message).toMatch(/check constraint/);
  });
});

describe("task photos", () => {
  it("lives in a private JPEG-only bucket and is server-only", async () => {
    const b = await db.query<{ public: boolean; allowed_mime_types: string[] }>("select public, allowed_mime_types from storage.buckets where id = 'task-photos'");
    expect(b.rows[0]).toEqual({ public: false, allowed_mime_types: ["image/jpeg"] });
    await svc(`insert into public.task_photos (file_path, bytes, uploaded_by) values ($1, 100, $2)`, [path(customerId), customerId]);
    for (const uid of [customerId, otherId]) {
      const e = await sqlError(as(db, "authenticated", uid, (tx) => tx.query("select * from public.task_photos")));
      expect(e.message).toMatch(/permission denied/);
    }
  });

  it("refuses odd file paths", async () => {
    const e = await sqlError(svc(`insert into public.task_photos (file_path, bytes, uploaded_by) values ('u/../etc/passwd.jpg', 100, $1)`, [customerId]));
    expect(e.message).toMatch(/check constraint/);
  });

  it("only the task's own customer can attach, at most 5 per task", async () => {
    const theirs = await svc(`insert into public.task_photos (file_path, bytes, uploaded_by) values ($1, 100, $2) returning id`, [path(otherId), otherId]);
    const stranger = await sqlError(svc(`update public.task_photos set deal_id = $1, attached_at = now() where id = $2`, [dealId, (theirs.rows[0] as { id: string }).id]));
    expect(stranger.message).toMatch(/belong to the task's customer/);

    for (let i = 0; i < 5; i++) {
      await svc(`insert into public.task_photos (deal_id, attached_at, file_path, bytes, uploaded_by) values ($1, now(), $2, 100, $3)`, [dealId, path(customerId), customerId]);
    }
    const sixth = await sqlError(svc(`insert into public.task_photos (deal_id, attached_at, file_path, bytes, uploaded_by) values ($1, now(), $2, 100, $3)`, [dealId, path(customerId), customerId]));
    expect(sixth.message).toMatch(/at most 5 photos/);
  });

  it("attached means both the task and the time are set", async () => {
    const e = await sqlError(svc(`insert into public.task_photos (attached_at, file_path, bytes, uploaded_by) values (now(), $1, 100, $2)`, [path(customerId), customerId]));
    expect(e.message).toMatch(/task_photos_attached/);
  });
});
