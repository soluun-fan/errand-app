import { type PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { applyTransitionArgs, insertDealArgs } from "@/lib/db/mapping";
import { amountDue, apply, createErrand, type Command, type ErrandDeal, type Transition, type UserActor } from "@/lib/engine";
import { as, createTestDb, loadDeal, rpc, sqlError } from "./pg";

/** Migration 20261122000000: one helper can't be booked (paid) on two tasks that raced. */
const customerA = "00000000-0000-4000-8000-0000000000a1";
const customerB = "00000000-0000-4000-8000-0000000000b1";
const helperId = "00000000-0000-4000-8000-0000000000c1";
const helper: UserActor = { kind: "user", id: helperId, role: "helper", helperApproved: true, categories: ["shop"] };
const provider = { kind: "provider" } as const;
let db: PGlite;
const t0 = Date.now();

beforeAll(async () => {
  db = await createTestDb();
  for (const [i, id] of [customerA, customerB, helperId].entries()) await db.query("insert into auth.users (id, phone) values ($1, $2)", [id, `9911000${i}`]);
  await db.query("update public.profiles set role = 'helper', helper_status = 'approved', kyc_level = 3, categories = '{shop}' where id = $1", [helperId]);
  await db.query("insert into public.payout_accounts (user_id, bank, account_number, holder_name) values ($1, 'Хаан банк', '5012345678', 'Test Helper')", [helperId]);
});
afterAll(async () => { await db?.close(); });

async function persist(before: ErrandDeal | null, t: Transition, now: number) {
  await as(db, "service_role", null, (tx) => rpc(tx, before ? "apply_transition" : "insert_deal", before ? applyTransitionArgs(before, t, now) : insertDealArgs(t)));
  return (await loadDeal(db, t.deal.id)) as ErrandDeal;
}
const step = (d: ErrandDeal, cmd: Command, actor: UserActor | typeof provider, now: number) => persist(d, apply(d, cmd, { now, actor }), now);
const pay = (d: ErrandDeal, now: number) => step(d, { type: "confirm_payment", providerRef: `pay-${d.id}-${now}`, amount: amountDue(d) }, provider, now);

/** A posted task the helper has taken; it now waits for the customer's payment. */
async function chosen(customerId: string, now: number) {
  const actor: UserActor = { kind: "user", id: customerId, role: "customer" };
  const t = createErrand({ id: crypto.randomUUID(), title: "Buy milk", description: "", category: "shop", mode: "now", scheduledAt: null, address: "Test", customerId, fee: 10_000, itemBudget: 0, invite: null }, { now, actor });
  const d = await step(await persist(null, t, now), { type: "accept" }, helper, now);
  expect(d.status).toBe("awaiting_payment");
  return d;
}

it("two payments racing for one helper: the second is refused and nothing of it is kept", async () => {
  const a = await chosen(customerA, t0);
  const b = await chosen(customerB, t0);
  expect((await pay(a, t0 + 1_000)).status).toBe("matched");
  const err = await sqlError(pay(b, t0 + 2_000));
  expect(err.code).toBe("PT410");
  const after = (await loadDeal(db, b.id)) as ErrandDeal;
  expect(after.status).toBe("awaiting_payment");
  expect(after.version).toBe(b.version);
  expect((await db.query("select count(*)::int as n from public.ledger_entries where deal_id = $1", [b.id])).rows).toEqual([{ n: 0 }]);
  // the helper backs out of A (now a penalty-free release of the other task is what the app does for B)
  await step((await loadDeal(db, a.id)) as ErrandDeal, { type: "cancel" }, helper, t0 + 3_000);
  // A is no longer theirs, so B can be booked
  expect((await pay(after, t0 + 4_000)).status).toBe("matched");
});

it("work booked before the helper was chosen elsewhere is not a conflict (e.g. a scheduled job)", async () => {
  const t = t0 + 60_000;
  const first = await chosen(customerA, t);
  await pay(first, t + 1_000);
  const later = await chosen(customerB, t + 5_000);
  expect((await pay(later, t + 6_000)).status).toBe("matched");
});

it("wire: a payment refused by the guard is refunded in full, once", async () => {
  const t = t0 + 120_000;
  const a = await chosen(customerA, t);
  const b = await chosen(customerB, t);
  await pay(a, t + 1_000);
  const amount = amountDue(b);
  const intent = `pi-${b.id}`;
  await db.query("insert into public.provider_payments(id,provider,deal_id,purpose,amount) values ($1,'wire',$2,'first',$3)", [intent, b.id, amount]);
  const transition = applyTransitionArgs(b, apply(b, { type: "confirm_payment", providerRef: intent, amount }, { now: t + 2_000, actor: provider }), t + 2_000);
  const settle = () => as(db, "service_role", null, async (tx) =>
    (await tx.query<{ result: string }>("select public.settle_wire_payment($1,$2,'charge',$3,$4) as result", [intent, amount, b.version, JSON.stringify(transition)])).rows[0].result);
  expect(await settle()).toBe("refunded_busy");
  expect(await settle()).toBe("already");
  expect((await loadDeal(db, b.id))?.status).toBe("awaiting_payment");
  expect((await db.query("select amount::int, reason from public.provider_refunds where payment_id = $1", [intent])).rows)
    .toEqual([{ amount, reason: "late payment: helper booked elsewhere" }]);
  expect((await db.query("select status from public.provider_payments where id = $1", [intent])).rows).toEqual([{ status: "refunded_late" }]);
  expect((await db.query("select count(*)::int as n from public.ledger_entries where deal_id = $1", [b.id])).rows).toEqual([{ n: 0 }]);
});
