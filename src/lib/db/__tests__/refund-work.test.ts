import { type PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";
import { applyTransitionArgs, insertDealArgs } from "@/lib/db/mapping";
import { amountDue, apply, createErrand, type Command, type ErrandDeal, type Transition, type UserActor } from "@/lib/engine";
import { as, createTestDb, loadDeal, rpc } from "./pg";

/** Migration 20261127010000: refund work is found by what is owed, whatever the payment's age. */
const customerId = "00000000-0000-4000-8000-0000000001a1";
const helperId = "00000000-0000-4000-8000-0000000001c1";
const customer: UserActor = { kind: "user", id: customerId, role: "customer" };
const helper: UserActor = { kind: "user", id: helperId, role: "helper", helperApproved: true, categories: ["shop"] };
let db: PGlite;
const t0 = Date.now();

beforeAll(async () => {
  db = await createTestDb();
  for (const [i, id] of [customerId, helperId].entries()) await db.query("insert into auth.users (id, phone) values ($1, $2)", [id, `9912000${i}`]);
  await db.query("update public.profiles set role = 'helper', helper_status = 'approved', kyc_level = 3, categories = '{shop}' where id = $1", [helperId]);
});
afterAll(async () => {
  await db?.close();
});

async function persist(before: ErrandDeal | null, t: Transition, now: number) {
  await as(db, "service_role", null, (tx) => rpc(tx, before ? "apply_transition" : "insert_deal", before ? applyTransitionArgs(before, t, now) : insertDealArgs(t)));
  return (await loadDeal(db, t.deal.id)) as ErrandDeal;
}
const step = (d: ErrandDeal, cmd: Command, actor: UserActor | { kind: "provider" }, now: number) => persist(d, apply(d, cmd, { now, actor }), now);
const work = async () =>
  as(db, "service_role", null, async (tx) => (await tx.query<{ id: string }>("select public.wire_refund_work(100) as id")).rows.map((r) => r.id));

it("finds a refund the ledger owes, then retries it only when due", async () => {
  const created = createErrand(
    { id: crypto.randomUUID(), title: "Buy milk", description: "", category: "shop", mode: "now", scheduledAt: null, address: "Test", customerId, fee: 10_000, itemBudget: 0, invite: null },
    { now: t0, actor: customer },
  );
  let d = await persist(null, created, t0);
  d = await step(d, { type: "accept" }, helper, t0 + 1_000);
  const intent = `pi-${d.id}`;
  const amount = amountDue(d);
  d = await step(d, { type: "confirm_payment", providerRef: intent, amount }, { kind: "provider" }, t0 + 2_000);
  // a wire payment made long ago: the old 30-day sweep would never have looked at it
  await db.query(
    "insert into public.provider_payments(id,provider,deal_id,purpose,amount,status,succeeded_at,created_at) values ($1,'wire',$2,'first',$3,'succeeded',now() - interval '60 days',now() - interval '60 days')",
    [intent, d.id, amount],
  );
  expect(await work()).not.toContain(d.id);
  d = await step(d, { type: "cancel" }, customer, t0 + 3_000);
  expect(await work()).toContain(d.id); // owed by the ledger, not yet asked of wire

  await as(db, "service_role", null, (tx) => tx.query("select public.queue_wire_refunds($1)", [d.id]));
  expect(await work()).toContain(d.id); // asked, but never sent

  const set = (sql: string) => db.query(`update public.provider_refunds set ${sql} where deal_id = $1`, [d.id]);
  await set("status = 'pending', provider_ref = 're_1', attempts = 1, updated_at = now()");
  expect(await work()).not.toContain(d.id); // wire has it: wait for its webhook
  await set("updated_at = now() - interval '2 hours'");
  expect(await work()).toContain(d.id); // no news for an hour: ask again (same idempotency key)
  await set("status = 'failed', provider_ref = null, attempts = 3, updated_at = now() - interval '5 minutes'");
  expect(await work()).not.toContain(d.id); // backoff after 3 tries is 8 minutes
  await set("updated_at = now() - interval '9 minutes'");
  expect(await work()).toContain(d.id);
  await set("attempts = 10");
  expect(await work()).not.toContain(d.id); // out of tries: Ops takes over on /ops/payments
});
