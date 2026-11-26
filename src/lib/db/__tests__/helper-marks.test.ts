import { type PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { applyTransitionArgs, insertDealArgs } from "@/lib/db/mapping";
import { MINUTE_MS, amountDue, apply, createErrand, type Command, type ErrandDeal, type Transition, type UserActor } from "@/lib/engine";
import { as, createTestDb, loadDeal, rpc } from "./pg";

/** Migration 20261122020000: late jobs leave one mark each; marks build the ladder. */
const customerId = "00000000-0000-4000-8000-0000000000d1";
const helperId = "00000000-0000-4000-8000-0000000000d2";
const helper: UserActor = { kind: "user", id: helperId, role: "helper", helperApproved: true, categories: ["shop"] };
const customer: UserActor = { kind: "user", id: customerId, role: "customer" };
const system = { kind: "system" } as const;
let db: PGlite;
let clock = Date.now();

beforeAll(async () => {
  db = await createTestDb();
  for (const [i, id] of [customerId, helperId].entries()) await db.query("insert into auth.users (id, phone) values ($1, $2)", [id, `9922000${i}`]);
  await db.query("update public.profiles set role = 'helper', helper_status = 'approved', kyc_level = 3, categories = '{shop}' where id = $1", [helperId]);
  await db.query("insert into public.payout_accounts (user_id, bank, account_number, holder_name) values ($1, 'Хаан банк', 'MN500005005012345678', 'Test Helper')", [helperId]);
});
afterAll(async () => { await db?.close(); });

async function persist(before: ErrandDeal | null, t: Transition, now: number) {
  await as(db, "service_role", null, (tx) => rpc(tx, before ? "apply_transition" : "insert_deal", before ? applyTransitionArgs(before, t, now) : insertDealArgs(t)));
  return (await loadDeal(db, t.deal.id)) as ErrandDeal;
}
const step = (d: ErrandDeal, cmd: Command, actor: UserActor | typeof system | { kind: "provider" }, now: number) => persist(d, apply(d, cmd, { now, actor }), now);

/** A paid job the helper never started; returns it once it is late. */
async function lateJob() {
  const t0 = (clock += 1_000);
  const t = createErrand({ id: crypto.randomUUID(), title: "Buy milk", description: "", category: "shop", mode: "now", scheduledAt: null, address: "Test", customerId, fee: 10_000, itemBudget: 0, invite: null }, { now: t0, actor: customer });
  let d = await step(await persist(null, t, t0), { type: "accept" }, helper, t0);
  d = await step(d, { type: "confirm_payment", providerRef: `p-${d.id}`, amount: amountDue(d) }, { kind: "provider" }, t0 + 1);
  return { d, lateAt: t0 + 61 * MINUTE_MS };
}
const marks = async () => (await db.query<{ kind: string }>("select kind from public.helper_marks where helper_id = $1 order by created_at", [helperId])).rows.map((r) => r.kind);
const pausedDays = async () => {
  const r = (await db.query<{ d: number | null }>("select extract(epoch from (suspended_until - now())) / 86400 as d from public.profiles where id = $1", [helperId])).rows[0];
  return r.d === null ? 0 : Math.round(Number(r.d));
};

it("one mark per late job (no-show upgrades it); 3 marks pause, 4 wait for Ops; voided marks don't count", async () => {
  const a = await lateJob();
  const late = await step(a.d, { type: "mark_late" }, system, a.lateAt);
  expect(await marks()).toEqual(["late"]);
  await step(late, { type: "replace_helper" }, customer, a.lateAt + 1);
  expect(await marks()).toEqual(["no_show"]); // still one mark for that job
  expect(await pausedDays()).toBe(0); // 1 mark: a warning only

  const b = await lateJob();
  await step(b.d, { type: "cancel" }, customer, b.lateAt); // late → free cancel → no-show mark
  expect(await marks()).toEqual(["no_show", "no_show"]);
  expect(await pausedDays()).toBe(0); // 2 marks: ranked lower (app side), not paused

  const c = await lateJob();
  await step(c.d, { type: "mark_late" }, system, c.lateAt);
  expect(await pausedDays()).toBe(3); // 3 marks: paused for marks_pause_days

  // Ops voids one after an appeal: the record drops back to 2
  await db.query("update public.helper_marks set voided_at = now() where deal_id = $1", [c.d.id]);
  expect((await db.query<{ n: number }>("select public.active_marks($1) as n", [helperId])).rows[0].n).toBe(2);

  await db.query("update public.profiles set suspended_until = null where id = $1", [helperId]);
  const e = await lateJob();
  await step(e.d, { type: "mark_late" }, system, e.lateAt);
  const f = await lateJob();
  await step(f.d, { type: "mark_late" }, system, f.lateAt);
  expect(await pausedDays()).toBeGreaterThan(365 * 50); // 4 active marks: paused until Ops reviews
});
