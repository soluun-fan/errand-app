import { type PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { applyTransitionArgs, insertDealArgs } from "@/lib/db/mapping";
import { HOUR_MS, MINUTE_MS, amountDue, apply, createErrand, type Command, type ErrandDeal, type Transition, type UserActor } from "@/lib/engine";
import { as, createTestDb, loadDeal, rpc } from "./pg";

/** Migration 20261124000000: the new task fields round-trip; no-show cancel and settle-first in the real ledger. */
const customerId = "00000000-0000-4000-8000-0000000000f1";
const helperId = "00000000-0000-4000-8000-0000000000f2";
const helper: UserActor = { kind: "user", id: helperId, role: "helper", helperApproved: true, categories: ["shop"] };
const customer: UserActor = { kind: "user", id: customerId, role: "customer" };
let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  for (const [i, id] of [customerId, helperId].entries()) await db.query("insert into auth.users (id, phone) values ($1, $2)", [id, `9944000${i}`]);
  await db.query("update public.profiles set role = 'helper', helper_status = 'approved', kyc_level = 3, categories = '{shop}' where id = $1", [helperId]);
  await db.query("insert into public.payout_accounts (user_id, bank, account_number, holder_name) values ($1, 'Хаан банк', '5012345678', 'Test Helper')", [helperId]);
});
afterAll(async () => { await db?.close(); });

async function persist(before: ErrandDeal | null, t: Transition, now: number) {
  await as(db, "service_role", null, (tx) => rpc(tx, before ? "apply_transition" : "insert_deal", before ? applyTransitionArgs(before, t, now) : insertDealArgs(t)));
  const reloaded = (await loadDeal(db, t.deal.id)) as ErrandDeal;
  expect(reloaded).toEqual(t.deal); // every field round-trips, the new ones included
  return reloaded;
}
const step = (d: ErrandDeal, cmd: Command, actor: UserActor | { kind: "system" | "provider" }, now: number) => persist(d, apply(d, cmd, { now, actor }), now);
const balance = async (account: string) => Number((await db.query<{ v: string }>("select public.account_balance($1) as v", [account])).rows[0].v);

async function started(t0: number) {
  const t = createErrand({ id: crypto.randomUUID(), title: "Buy", description: "", category: "shop", mode: "now", scheduledAt: null, address: "Test", customerId, fee: 10_000, itemBudget: 20_000, invite: null }, { now: t0, actor: customer });
  let d = await step(await persist(null, t, t0), { type: "accept" }, helper, t0);
  d = await step(d, { type: "confirm_payment", providerRef: `p-${d.id}`, amount: amountDue(d) }, { kind: "provider" }, t0 + 1);
  d = await step(d, { type: "on_my_way" }, helper, t0 + 2);
  d = await step(d, { type: "need_time", minutes: 15 }, helper, t0 + 3);
  return step(d, { type: "start" }, helper, t0 + 10 * MINUTE_MS);
}

it("no-show: the trip fee and the shopping go to the helper, the rest back to the customer; the hold is empty", async () => {
  const t0 = Date.now();
  let d = await started(t0);
  expect(d.enRouteAt).toBe(t0 + 2);
  expect(d.arriveExtendMinutes).toBe(15);
  d = await step(d, { type: "record_receipt", amount: 18_500 }, helper, t0 + 30 * MINUTE_MS);
  const payableBefore = await balance(`payable:${helperId}`);
  d = await step(d, { type: "customer_absent" }, helper, t0 + 40 * MINUTE_MS);
  d = await step(d, { type: "absent_cancel" }, { kind: "system" }, t0 + 51 * MINUTE_MS);
  expect(d.status).toBe("cancelled");
  expect(d.heldAmount).toBe(0);
  expect(await balance(`payable:${helperId}`) - payableBefore).toBe(18_500 + d.cancelFee);
});

it("settle first: an accepted partial refund goes back at once and the helper is released the rest", async () => {
  const t0 = Date.now() + 60_000;
  let d = await started(t0);
  d = await step(d, { type: "record_receipt", amount: 15_000 }, helper, t0 + 15 * MINUTE_MS);
  d = await step(d, { type: "record_handover" }, helper, t0 + 20 * MINUTE_MS);
  d = await step(d, { type: "finish" }, helper, t0 + 21 * MINUTE_MS);
  d = await step(d, { type: "propose_price", price: 7_000 }, customer, t0 + 22 * MINUTE_MS);
  d = await step(d, { type: "answer_price", accept: true }, helper, t0 + 23 * MINUTE_MS);
  expect(d.fee).toBe(7_000);
  d = await step(d, { type: "confirm" }, customer, t0 + 24 * MINUTE_MS);
  expect(d.status).toBe("released");
  // an unanswered offer instead goes to Ops after the settle hours
  const e = await started(t0 + HOUR_MS);
  let f = await step(e, { type: "record_receipt", amount: 15_000 }, helper, t0 + HOUR_MS + 15 * MINUTE_MS);
  f = await step(f, { type: "record_handover" }, helper, t0 + HOUR_MS + 20 * MINUTE_MS);
  f = await step(f, { type: "finish" }, helper, t0 + HOUR_MS + 21 * MINUTE_MS);
  f = await step(f, { type: "propose_price", price: 5_000 }, customer, t0 + HOUR_MS + 22 * MINUTE_MS);
  f = await step(f, { type: "escalate_offer" }, { kind: "system" }, t0 + HOUR_MS + 22 * MINUTE_MS + 25 * HOUR_MS);
  expect(f.status).toBe("disputed");
  expect(f.dispute?.reason).toBe("no_agreement");
});
