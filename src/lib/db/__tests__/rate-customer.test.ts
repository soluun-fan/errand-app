import { type PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { applyTransitionArgs, insertDealArgs } from "@/lib/db/mapping";
import { amountDue, apply, createErrand, type Command, type ErrandDeal, type Transition, type UserActor } from "@/lib/engine";
import { as, createTestDb, loadDeal, rpc, sqlError } from "./pg";

/** Migration 20261122040000: helpers rate customers, kept apart from helper ratings. */
const customerId = "00000000-0000-4000-8000-0000000000e1";
const helperId = "00000000-0000-4000-8000-0000000000e2";
const helper: UserActor = { kind: "user", id: helperId, role: "helper", helperApproved: true, categories: ["queue"] };
const customer: UserActor = { kind: "user", id: customerId, role: "customer" };
let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  for (const [i, id] of [customerId, helperId].entries()) await db.query("insert into auth.users (id, phone) values ($1, $2)", [id, `9933000${i}`]);
  await db.query("update public.profiles set role = 'helper', helper_status = 'approved', kyc_level = 3, categories = '{queue}' where id = $1", [helperId]);
  await db.query("insert into public.payout_accounts (user_id, bank, account_number, holder_name) values ($1, 'Хаан банк', '5012345678', 'Test Helper')", [helperId]);
});
afterAll(async () => { await db?.close(); });

async function persist(before: ErrandDeal | null, t: Transition, now: number) {
  await as(db, "service_role", null, (tx) => rpc(tx, before ? "apply_transition" : "insert_deal", before ? applyTransitionArgs(before, t, now) : insertDealArgs(t)));
  return (await loadDeal(db, t.deal.id)) as ErrandDeal;
}
const step = (d: ErrandDeal, cmd: Command, actor: UserActor | { kind: "provider" }, now: number) => persist(d, apply(d, cmd, { now, actor }), now);
const rate = (from: string, dealId: string, stars: number) => as(db, "service_role", null, (tx) => tx.query("select public.rate_customer($1, $2, $3::smallint, '{clear}', 'Nice')", [dealId, from, stars]));

it("only the job's helper rates its customer, once, after release; it never counts as a helper rating", async () => {
  const now = Date.now();
  let d = await persist(null, createErrand({ id: crypto.randomUUID(), title: "Queue", description: "", category: "queue", mode: "now", scheduledAt: null, address: "Test", customerId, fee: 10_000, itemBudget: 0, invite: null }, { now, actor: customer }), now);
  d = await step(d, { type: "accept" }, helper, now);
  d = await step(d, { type: "confirm_payment", providerRef: `p-${d.id}`, amount: amountDue(d) }, { kind: "provider" }, now);
  expect((await sqlError(rate(helperId, d.id, 5))).code).toBe("PT409"); // not finished yet
  d = await step(d, { type: "start" }, helper, now);
  d = await step(d, { type: "record_handover" }, helper, now);
  d = await step(d, { type: "finish" }, helper, now);
  d = await step(d, { type: "confirm" }, customer, now);
  expect(d.status).toBe("released");
  expect((await sqlError(rate(customerId, d.id, 1))).code).toBe("PT409"); // the customer can't rate themselves this way
  await rate(helperId, d.id, 4);
  expect((await sqlError(rate(helperId, d.id, 4))).code).toBe("23505"); // once
  const p = (await db.query<{ customer_rating_sum: number; customer_rating_count: number; rating_count: number }>(
    "select customer_rating_sum, customer_rating_count, rating_count from public.profiles where id = $1", [customerId])).rows[0];
  expect(p).toEqual({ customer_rating_sum: 4, customer_rating_count: 1, rating_count: 0 });
  expect((await db.query("select about from public.ratings where deal_id = $1", [d.id])).rows).toEqual([{ about: "customer" }]);
});
