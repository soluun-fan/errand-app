import { type PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { applyTransitionArgs, insertDealArgs } from "@/lib/db/mapping";
import { amountDue, apply, createErrand, type Command, type ErrandDeal, type Transition, type UserActor } from "@/lib/engine";
import { as, createTestDb, loadDeal, rpc, sqlError } from "./pg";

/** Migration 20261125010000: the landing page's real totals and the company details for the footer. */
const customerId = "00000000-0000-4000-8000-0000000000f1";
const helperId = "00000000-0000-4000-8000-0000000000f2";
const helper: UserActor = { kind: "user", id: helperId, role: "helper", helperApproved: true, categories: ["queue"] };
const customer: UserActor = { kind: "user", id: customerId, role: "customer" };
let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  for (const [i, id] of [customerId, helperId].entries()) await db.query("insert into auth.users (id, phone) values ($1, $2)", [id, `9934000${i}`]);
  await db.query("update public.profiles set role = 'helper', helper_status = 'approved', kyc_level = 3, categories = '{queue}' where id = $1", [helperId]);
  await db.query("insert into public.payout_accounts (user_id, bank, account_number, holder_name) values ($1, 'Хаан банк', 'MN500005005012345678', 'Test Helper')", [helperId]);
});
afterAll(async () => { await db?.close(); });

async function persist(before: ErrandDeal | null, t: Transition, now: number) {
  await as(db, "service_role", null, (tx) => rpc(tx, before ? "apply_transition" : "insert_deal", before ? applyTransitionArgs(before, t, now) : insertDealArgs(t)));
  return (await loadDeal(db, t.deal.id)) as ErrandDeal;
}
const step = (d: ErrandDeal, cmd: Command, actor: UserActor | { kind: "provider" }, now: number) => persist(d, apply(d, cmd, { now, actor }), now);

/** A finished job the customer rates `stars`. */
async function finishedJob(title: string, stars: number) {
  const now = Date.now();
  let d = await persist(null, createErrand({ id: crypto.randomUUID(), title, description: "", category: "queue", mode: "now", scheduledAt: null, address: "Test", customerId, fee: 10_000, itemBudget: 0, invite: null }, { now, actor: customer }), now);
  d = await step(d, { type: "accept" }, helper, now);
  d = await step(d, { type: "confirm_payment", providerRef: `p-${d.id}`, amount: amountDue(d) }, { kind: "provider" }, now);
  d = await step(d, { type: "start" }, helper, now);
  d = await step(d, { type: "record_handover" }, helper, now);
  d = await step(d, { type: "finish" }, helper, now);
  d = await step(d, { type: "confirm" }, customer, now);
  await as(db, "service_role", null, (tx) => tx.query("select public.rate_deal($1, $2, $3::smallint)", [d.id, customerId, stars]));
  // the helper's review of the customer is not a review of the service
  await as(db, "service_role", null, (tx) => tx.query("select public.rate_customer($1, $2, 1::smallint, '{}', null)", [d.id, helperId]));
}

const stats = () =>
  as(db, "service_role", null, async (tx) => {
    const r = (await tx.query<Record<string, unknown>>("select * from public.public_stats()")).rows[0];
    return { done: Number(r.done), helpers: Number(r.helpers), reviews: Number(r.reviews), avg: r.avg_stars === null ? null : Number(r.avg_stars) };
  });

it("counts real finished jobs, approved helpers and customers' reviews — never test tasks", async () => {
  expect(await stats()).toEqual({ done: 0, helpers: 1, reviews: 0, avg: null });
  await finishedJob("Queue for me", 5);
  await finishedJob("Another queue", 4);
  await finishedJob("[verify] pilot check", 1);
  expect(await stats()).toEqual({ done: 2, helpers: 1, reviews: 2, avg: 4.5 });
  // a suspended helper isn't counted
  await db.query("update public.profiles set suspended_until = now() + interval '1 day' where id = $1", [helperId]);
  expect((await stats()).helpers).toBe(0);
});

it("is server-only", async () => {
  for (const role of ["anon", "authenticated"] as const) {
    expect((await sqlError(as(db, role, role === "anon" ? null : customerId, (tx) => tx.query("select * from public.public_stats()")))).code).toBe("42501");
  }
});

it("keeps company details next to the support channels, each optional and bounded", async () => {
  expect((await db.query("select company_name, company_reg_no, company_address from public.support_settings")).rows).toEqual([{ company_name: null, company_reg_no: null, company_address: null }]);
  expect((await sqlError(db.query("update public.support_settings set company_reg_no = repeat('1', 41)"))).code).toBe("23514");
});

it("shows a work photo's price only when the customer agreed under wording that says so", async () => {
  // photos agreed before this change were promised "only the kind of job is shown": they default to false
  const col = (await db.query<{ column_default: string; is_nullable: string }>(
    "select column_default, is_nullable from information_schema.columns where table_name = 'work_photos' and column_name = 'show_price'")).rows[0];
  expect(col).toEqual({ column_default: "false", is_nullable: "NO" });
});
