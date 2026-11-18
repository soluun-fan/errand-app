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

describe("kind cover pictures", () => {
  it("live in a PUBLIC JPEG-only bucket (generic pictures) and the path is checked", async () => {
    const b = await db.query<{ public: boolean; allowed_mime_types: string[] }>("select public, allowed_mime_types from storage.buckets where id = 'kind-covers'");
    expect(b.rows[0]).toEqual({ public: true, allowed_mime_types: ["image/jpeg"] });
    await svc(`update public.category_settings set cover_path = $1 where category = 'shop'`, [`shop/${crypto.randomUUID()}.jpg`]);
    const bad = await sqlError(svc(`update public.category_settings set cover_path = '../task-photos/u/x.jpg' where category = 'shop'`));
    expect(bad.message).toMatch(/check constraint/);
    await svc(`update public.category_settings set cover_path = null where category = 'shop'`);
  });
});

describe("minimum price per kind", () => {
  it("starts rubbish lower, hard work higher, day jobs and care by the hour; one kind of floor at a time", async () => {
    const r = await db.query<{ category: string; min_fee: number | null; min_hourly: number | null }>(
      "select category, min_fee, min_hourly from public.category_settings where category in ('trash','shop','carry','dayjob','childcare') order by category",
    );
    expect([...r.rows].sort((a, b) => a.category.localeCompare(b.category))).toEqual([
      { category: "carry", min_fee: 10000, min_hourly: null },
      { category: "childcare", min_fee: null, min_hourly: 8000 },
      { category: "dayjob", min_fee: null, min_hourly: 6000 },
      { category: "shop", min_fee: null, min_hourly: null },
      { category: "trash", min_fee: 3000, min_hourly: null },
    ]);
    const both = await sqlError(svc("update public.category_settings set min_fee = 5000, min_hourly = 5000 where category = 'shop'"));
    expect(both.message).toMatch(/category_settings_one_floor/);
    const silly = await sqlError(svc("update public.category_settings set min_fee = 10 where category = 'shop'"));
    expect(silly.message).toMatch(/check constraint/);
  });
});

describe("taking back a photo", () => {
  it("only progress / handover photos can be marked removed, always with who and when", async () => {
    const p = await svc(`insert into public.proofs (deal_id, kind, uploaded_by) values ($1, 'progress', $2) returning id`, [dealId, customerId]);
    const s = await svc(`insert into public.proofs (deal_id, kind, uploaded_by) values ($1, 'start', $2) returning id`, [dealId, customerId]);
    const pid = (p.rows[0] as { id: string }).id;
    const sid = (s.rows[0] as { id: string }).id;
    await svc(`update public.proofs set removed_at = now(), removed_by = $2 where id = $1`, [pid, customerId]);
    const start = await sqlError(svc(`update public.proofs set removed_at = now(), removed_by = $2 where id = $1`, [sid, customerId]));
    expect(start.message).toMatch(/proofs_removable_kind/);
    const half = await sqlError(svc(`update public.proofs set removed_at = now() where id = $1`, [sid]));
    expect(half.message).toMatch(/proofs_removed_pair|proofs_removable_kind/);
  });
});

describe("rules from the database", () => {
  it("has one settings row with safe defaults, and refuses nonsense", async () => {
    const r = await db.query<{ payment_window_minutes: number; pause_days_first: number; care_call_min_seconds: number; waves: number }>(
      "select payment_window_minutes, pause_days_first, care_call_min_seconds, jsonb_array_length(dispatch_waves) as waves from public.platform_rules",
    );
    expect(r.rows).toEqual([{ payment_window_minutes: 10, pause_days_first: 1, care_call_min_seconds: 30, waves: 4 }]);
    expect((await sqlError(svc("insert into public.platform_rules (id) values (false)"))).message).toMatch(/check constraint|duplicate/);
    expect((await sqlError(svc("update public.platform_rules set payment_window_minutes = 0"))).message).toMatch(/check constraint/);
    expect((await sqlError(svc("update public.platform_rules set pause_days_first = 5, pause_days_second = 3"))).message).toMatch(/platform_rules_pauses_grow/);
    expect((await sqlError(svc("update public.platform_rules set care_day_start_hour = 20, care_day_end_hour = 9"))).message).toMatch(/platform_rules_care_window/);
    for (const role of ["anon", "authenticated"] as const) {
      const e = await sqlError(as(db, role, role === "anon" ? null : customerId, (tx) => tx.query("select * from public.platform_rules")));
      expect(e.message).toMatch(/permission denied/);
    }
  });
});

describe("fee-only payments (wire.mn)", () => {
  it("tasks remember their payment mode; new tasks take the full amount (managed service); payment tables are server-only", async () => {
    expect((await db.query<{ v: string }>("select pay_mode as v from public.platform_rules")).rows[0].v).toBe("held");
    expect((await db.query<{ v: string }>("select pay_mode as v from public.deals where id = $1", [dealId])).rows[0].v).toBe("held"); // posted by the engine default here
    expect((await sqlError(svc("update public.platform_rules set pay_mode = 'free'"))).message).toMatch(/check constraint/);
    for (const table of ["provider_payments", "provider_events", "provider_refunds", "direct_payments"]) {
      const e = await sqlError(as(db, "authenticated", customerId, (tx) => tx.query(`select * from public.${table}`)));
      expect(e.message).toMatch(/permission denied/);
    }
    // one live payment attempt per task and purpose
    await svc("insert into public.provider_payments (id, provider, deal_id, purpose, amount) values ('pi_a', 'wire', $1, 'fee-1', 1000)", [dealId]);
    const dup = await sqlError(svc("insert into public.provider_payments (id, provider, deal_id, purpose, amount) values ('pi_b', 'wire', $1, 'fee-1', 1000)", [dealId]));
    expect(dup.message).toMatch(/provider_payments_one_pending|duplicate/);
    expect((await sqlError(svc("insert into public.provider_payments (id, provider, deal_id, purpose, amount, checkout_url) values ('pi_c', 'wire', $1, 'fee-2', 1000, 'http://evil')", [dealId]))).message).toMatch(/check constraint/);
  });
});
