import type { PGlite, Transaction } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { actorFromProfile, applyTransitionArgs, insertDealArgs, type ProfileRow } from "@/lib/db/mapping";
import {
  DEFAULT_CONFIG,
  HOUR_MS,
  amountDue,
  apply,
  createErrand,
  createGoods,
  runDue,
  type Actor,
  type Command,
  type Deal,
  type NewErrandInput,
  type Transition,
  type UserActor,
} from "@/lib/engine";
import { TEST_CONFIG } from "@/lib/engine/__tests__/helpers";
import { as, createTestDb, loadDeal, rpc, sqlError } from "./pg";

const U = {
  c1: "00000000-0000-4000-8000-000000000001",
  c2: "00000000-0000-4000-8000-000000000002",
  h1: "00000000-0000-4000-8000-000000000011",
  h2: "00000000-0000-4000-8000-000000000012",
  ops: "00000000-0000-4000-8000-000000000099",
};
const customer = (id: string): UserActor => ({ kind: "user", id, role: "customer" });
const helper = (id: string, categories: UserActor["categories"] = ["shop", "carry", "queue", "deliver", "repair", "other"]): UserActor => ({
  kind: "user",
  id,
  role: "helper",
  helperApproved: true,
  categories,
});
const admin: UserActor = { kind: "user", id: U.ops, role: "admin" };
const provider: Actor = { kind: "provider" };
const T0 = Date.UTC(2026, 10, 12, 8, 0, 0);

let db: PGlite;
let seq = 0;
const dealId = () => `10000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

beforeAll(async () => {
  db = await createTestDb();
  // Sign-ups go through auth.users; the trigger must create profiles.
  for (const [k, id] of Object.entries(U)) {
    await db.query(`insert into auth.users (id, phone, raw_user_meta_data) values ($1, $2, $3)`, [
      id,
      `9768800${id.slice(-4)}`,
      JSON.stringify({ name: k.toUpperCase() }),
    ]);
  }
  await db.exec(`
    update public.profiles set role = 'helper', helper_status = 'approved',
      categories = '{shop,carry,queue,deliver,repair,other}' where id = '${U.h1}';
    update public.profiles set role = 'helper', helper_status = 'approved', categories = '{shop}' where id = '${U.h2}';
    update public.profiles set role = 'admin' where id = '${U.ops}';
    -- a worker needs a bank account to work (migration 20261118050000)
    insert into public.payout_accounts (user_id, bank, account_number, holder_name) values
      ('${U.h1}', 'Хаан банк', '5012345678', 'Helper One'), ('${U.h2}', 'Голомт банк', '1234567890', 'Helper Two');
  `);
});

/** Persist like the server: service role, one RPC per transition, then reload and compare. */
async function persist(before: Deal | null, t: Transition, now: number): Promise<Deal> {
  await as(db, "service_role", null, async (tx) => {
    if (before === null) await rpc(tx, "insert_deal", insertDealArgs(t));
    else await rpc(tx, "apply_transition", applyTransitionArgs(before, t, now));
  });
  const reloaded = await loadDeal(db, t.deal.id);
  // Round trip: what the DB stores is exactly what the engine produced.
  expect(reloaded).toEqual(t.deal);
  return reloaded as Deal;
}

async function step(deal: Deal, cmd: Command, actor: Actor, now: number): Promise<Deal> {
  return persist(deal, apply(deal, cmd, { now, actor }), now);
}

async function postErrand(input: Partial<NewErrandInput> = {}, now = T0): Promise<Deal> {
  const t = createErrand(
    {
      id: dealId(),
      title: "Groceries",
      description: "Milk",
      category: "shop",
      mode: "now",
      address: "8th khoroo",
      itemBudget: 38000,
      fee: 9000,
      customerId: U.c1,
      ...input,
    },
    { now, actor: customer(input.customerId ?? U.c1) },
    TEST_CONFIG, // flow tests keep the demo economics (10%, ₮1,000 fee, any price)
  );
  return persist(null, t, now);
}

const pay = (d: Deal, now = T0, ref = `qpay-${d.id}`) =>
  step(d, { type: "confirm_payment", providerRef: ref, amount: amountDue(d) }, provider, now);

/** Posted and accepted by h1, not paid yet. */
const matched = async (input: Partial<NewErrandInput> = {}) => step(await postErrand(input), { type: "accept" }, helper(U.h1), T0);

async function scalar<T>(q: PGlite | Transaction, sql: string, params: unknown[] = []): Promise<T> {
  const r = await q.query<{ v: T }>(sql, params);
  return r.rows[0].v;
}

async function noViolations() {
  const r = await db.query(`select * from public.ledger_invariant_violations()`);
  expect(r.rows).toEqual([]);
}

describe("migration", () => {
  // Mirrors the Supabase security advisor so findings are caught before `db push`.
  it("has no SECURITY DEFINER views in the API schema", async () => {
    const r = await db.query(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'v'
        and not coalesce(c.reloptions @> array['security_invoker=true'], false)`);
    expect(r.rows).toEqual([]);
  });

  it("exposes no SECURITY DEFINER function to API callers", async () => {
    const r = await db.query(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`);
    expect(r.rows).toEqual([]);
  });

  it("creates a profile for every auth user", async () => {
    const r = await db.query<{ name: string; phone: string; role: string }>(
      `select name, phone, role from public.profiles where id = $1`,
      [U.c1],
    );
    expect(r.rows[0]).toEqual({ name: "C1", phone: "97688000001", role: "customer" });
  });
});

describe("engine → database round trip", () => {
  it("errand: full happy path, money matches the engine at every step", async () => {
    let d = await postErrand();
    d = await step(d, { type: "accept" }, helper(U.h1), T0 + 60_000);
    d = await pay(d, T0 + 90_000);
    d = await step(d, { type: "start" }, helper(U.h1), T0 + 120_000);
    d = await step(d, { type: "record_receipt", amount: 35500 }, helper(U.h1), T0 + 180_000);
    d = await step(d, { type: "record_handover" }, helper(U.h1), T0 + 240_000);
    d = await step(d, { type: "finish" }, helper(U.h1), T0 + 300_000);
    expect(d.status).toBe("check");

    // background job after the window
    const later = T0 + 300_000 + 24 * HOUR_MS;
    const t = runDue(d, later);
    expect(t).not.toBeNull();
    d = await persist(d, t as Transition, later);
    expect(d.status).toBe("released");

    const bal = (acc: string) => scalar<string>(db, `select public.account_balance($1, $2)::text as v`, [acc, d.id]);
    expect(await bal(`payable:${U.h1}`)).toBe(String(9000 - 900 + 35500));
    expect(await bal(`ext:${U.c1}`)).toBe(String(-48000 + 2500));
    expect(await bal("platform")).toBe("1900");
    expect(await bal("hold")).toBe("0");
    expect(await scalar<number>(db, `select count(*)::int as v from public.timeline_events where deal_id = $1`, [d.id])).toBe(9);
    await noViolations();
  });

  it("over-budget top-up: second payment grows the item budget; round trip + buffer details persist", async () => {
    let d = await postErrand({ itemBudget: 50000, fee: 10500, details: { km: 2, roundTrip: true, budgetBuffer: true } }); // 6000 + 2 km + ½ return
    expect(d.type === "errand" && d.itemBudget).toBe(55000);
    d = await step(d, { type: "accept" }, helper(U.h1), T0 + 60_000);
    d = await pay(d, T0 + 90_000);
    d = await step(d, { type: "start" }, helper(U.h1), T0 + 120_000);
    d = await step(d, { type: "record_receipt", amount: 58000 }, helper(U.h1), T0 + 180_000);
    expect(d.type === "errand" && d.topUp).toMatchObject({ amount: 3000, status: "pending" });
    d = await step(d, { type: "confirm_topup", providerRef: `tu-${d.id}`, amount: 3000 }, provider, T0 + 200_000);
    expect(d.heldAmount).toBe(58000 + 10500 + 1000);
    d = await step(d, { type: "record_handover" }, helper(U.h1), T0 + 240_000);
    d = await step(d, { type: "finish" }, helper(U.h1), T0 + 300_000);
    d = await step(d, { type: "confirm" }, customer(U.c1), T0 + 360_000);
    const bal = (acc: string) => scalar<string>(db, `select public.account_balance($1, $2)::text as v`, [acc, d.id]);
    expect(await bal(`payable:${U.h1}`)).toBe(String(10500 - 1050 + 58000));
    expect(await bal("hold")).toBe("0");
    await noViolations();
  });

  it("scheduled errand: offers are stored and reloaded in order", async () => {
    let d = await postErrand({ mode: "schedule", scheduledAt: T0 + 30 * HOUR_MS, itemBudget: 0 });
    d = await step(d, { type: "apply", note: "first" }, helper(U.h1), T0 + 1000);
    d = await step(d, { type: "apply", note: "second", price: 12000 }, helper(U.h2, ["shop"]), T0 + 2000);
    d = await step(d, { type: "choose", helperId: U.h2 }, customer(U.c1), T0 + 3000);
    expect(d.type === "errand" && d.offers.map((o) => [o.note, o.price])).toEqual([["first", null], ["second", 12000]]);
    d = await pay(d, T0 + 4000);
    expect(d.heldAmount).toBe(12000 + 1000);
    await noViolations();
  });

  it("a match not paid in time reopens the task (booked: 30 min): fee, pay_by and the dropped offer persist", async () => {
    let d = await postErrand({ mode: "schedule", scheduledAt: T0 + 30 * HOUR_MS, itemBudget: 0, location: { lat: 47.9184, lng: 106.9177 } });
    expect(d.type === "errand" && d.location).toEqual({ lat: 47.9184, lng: 106.9177 });
    d = await step(d, { type: "apply", note: "quote", price: 20000 }, helper(U.h1), T0 + 1000);
    d = await step(d, { type: "choose", helperId: U.h1 }, customer(U.c1), T0 + 2000);
    expect(d).toMatchObject({ status: "awaiting_payment", fee: 20000 });
    const later = T0 + 2000 + 30 * 60_000;
    d = await persist(d, runDue(d, later) as Transition, later); // persist() asserts DB == engine
    expect(d).toMatchObject({ status: "open", fee: 9000, payBy: null, helperId: null, offers: [] });
    await noViolations();
  });

  it("SafePay: dispute → Ops refund returns everything to the buyer", async () => {
    const t = createGoods(
      { id: dealId(), title: "iPhone 13", price: 1_350_000, checkHours: 72, sellerId: U.c1, code: "7K2Q9F" },
      { now: T0, actor: customer(U.c1) },
    );
    let d = await persist(null, t, T0);
    d = await step(d, { type: "claim" }, customer(U.c2), T0 + 1);
    d = await pay(d, T0 + 2);
    d = await step(d, { type: "handover" }, customer(U.c1), T0 + 3);
    d = await step(d, { type: "dispute", reason: "Not as described", note: "Cracked" }, customer(U.c2), T0 + 4);
    d = await step(d, { type: "resolve", outcome: "refund" }, admin, T0 + 5);
    expect(d.status).toBe("refunded");
    expect(d.dispute).toMatchObject({ outcome: "refund", decidedBy: U.ops, note: "Cracked" });
    expect(await scalar<string>(db, `select public.account_balance($1, $2)::text as v`, [`ext:${U.c2}`, d.id])).toBe("0");
    await noViolations();
  });

  it("a task nobody takes expires after 30 min; pickup address round-trips", async () => {
    let d = await postErrand({ pickupAddress: "Nomin supermarket", itemBudget: 0 });
    expect(d.type === "errand" && d.pickupAddress).toBe("Nomin supermarket");
    const later = T0 + 31 * 60_000;
    d = await persist(d, runDue(d, later) as Transition, later);
    expect(d.status).toBe("expired");
    await noViolations();
  });

  it("rating: once per deal, only by the customer after release; stats update", async () => {
    let d = await postErrand({ itemBudget: 0 });
    d = await step(d, { type: "accept" }, helper(U.h1), T0);
    d = await pay(d);
    d = await step(d, { type: "start" }, helper(U.h1), T0);
    d = await step(d, { type: "record_handover" }, helper(U.h1), T0);
    d = await step(d, { type: "finish" }, helper(U.h1), T0);

    const rate = (from: string) =>
      as(db, "service_role", null, (tx) =>
        tx.query(`select public.rate_deal($1, $2, 5::smallint, '{On time,Careful}', 'Great')`, [d.id, from]),
      );
    expect((await sqlError(rate(U.c1))).code).toBe("PT409"); // not released yet

    const before = await db.query<{ completed_count: number; rating_count: number }>(
      `select completed_count, rating_count from public.profiles where id = $1`,
      [U.h1],
    );
    d = await step(d, { type: "confirm" }, customer(U.c1), T0);
    await rate(U.c1);
    expect((await sqlError(rate(U.c1))).message).toMatch(/duplicate key|unique/);
    expect((await sqlError(rate(U.h1))).code).toBe("PT409"); // helper can't rate via this
    const after = await db.query<{ completed_count: number; rating_count: number }>(
      `select completed_count, rating_count from public.profiles where id = $1`,
      [U.h1],
    );
    expect(after.rows[0].completed_count).toBe(before.rows[0].completed_count + 1);
    expect(after.rows[0].rating_count).toBe(before.rows[0].rating_count + 1);
  });

  it("a late back-out reopens the task and pauses the helper: 1 day, then 3, then 7 (within 30 days)", async () => {
    const h = helper(U.h2, ["shop"]);
    const pauseAfter = async (at: number) => {
      let d = await postErrand({ itemBudget: 0 });
      d = await step(d, { type: "accept" }, h, at);
      d = await pay(d);
      d = await step(d, { type: "cancel" }, h, at + 11 * 60_000); // after the 10-minute grace
      expect(d.status).toBe("open");
      expect(d.heldAmount).toBe(0);
      const r = await db.query<{ v: string }>(`select to_jsonb(suspended_until) #>> '{}' as v from public.profiles where id = $1`, [U.h2]);
      return (Date.parse(r.rows[0].v) - (at + 11 * 60_000)) / 86_400_000;
    };
    expect(await pauseAfter(T0)).toBe(1);
    expect(await pauseAfter(T0 + 2 * 86_400_000)).toBe(3);
    expect(await pauseAfter(T0 + 6 * 86_400_000)).toBe(7);
    const rows = await db.query<{ pause_days: number; nth_in_30d: number }>(`select pause_days, nth_in_30d from public.helper_penalties where helper_id = $1 order by created_at`, [U.h2]);
    expect(rows.rows).toEqual([
      { pause_days: 1, nth_in_30d: 1 },
      { pause_days: 3, nth_in_30d: 2 },
      { pause_days: 7, nth_in_30d: 3 },
    ]);
    // a suspended helper is not approved until the pause ends
    const p = await db.query<ProfileRow>(
      `select id, name, phone, role, kyc_level, helper_status, verified_name, categories, area, to_jsonb(suspended_until) #>> '{}' as suspended_until from public.profiles where id = $1`,
      [U.h2],
    );
    const prof = { ...p.rows[0], categories: ["shop" as const] };
    expect(actorFromProfile(prof, T0 + 8 * 86_400_000).helperApproved).toBe(false);
    expect(actorFromProfile(prof, T0 + 14 * 86_400_000).helperApproved).toBe(true);
    // helpers can't read the penalty rows themselves (server only)
    const denied = await sqlError(as(db, "authenticated", U.h2, (tx) => tx.query("select * from public.helper_penalties")));
    expect(denied.message).toMatch(/permission denied/);
    await db.query(`update public.profiles set suspended_until = null where id = $1`, [U.h2]);
    await db.query(`delete from public.helper_penalties where helper_id = $1`, [U.h2]);
  });
});

describe("pause lengths come from the Ops rules", () => {
  it("a late back-out pauses for the number of days Ops set", async () => {
    await db.query("delete from public.helper_penalties where helper_id = $1", [U.h2]);
    await db.query("update public.platform_rules set pause_days_first = 2");
    const h = helper(U.h2, ["shop"]);
    let d = await postErrand({ itemBudget: 0 });
    d = await step(d, { type: "accept" }, h, T0);
    d = await pay(d);
    d = await step(d, { type: "cancel" }, h, T0 + 11 * 60_000);
    const r = await db.query<{ pause_days: number }>("select pause_days from public.helper_penalties where deal_id = $1", [d.id]);
    expect(r.rows).toEqual([{ pause_days: 2 }]);
    await db.query("update public.platform_rules set pause_days_first = 1");
    await db.query("update public.profiles set suspended_until = null where id = $1", [U.h2]);
    await db.query("delete from public.helper_penalties where helper_id = $1", [U.h2]);
  });
});

describe("database safety nets (even if app code is wrong)", () => {
  it("rejects a stale write (optimistic locking) with PT409", async () => {
    const d = await postErrand();
    const stale = d;
    await step(d, { type: "accept" }, helper(U.h1), T0);
    const t = apply(stale, { type: "accept" }, { now: T0, actor: helper(U.h2, ["shop"]) });
    const err = await sqlError(
      as(db, "service_role", null, (tx) => rpc(tx, "apply_transition", applyTransitionArgs(stale, t, T0))),
    );
    expect(err.code).toBe("PT409");
    const now = await loadDeal(db, d.id);
    expect(now?.type === "errand" && now.helperId).toBe(U.h1);
  });

  it("rejects illegal status jumps written directly", async () => {
    const d = await postErrand();
    const err = await sqlError(db.query(`update public.deals set status = 'released' where id = $1`, [d.id]));
    expect(err.code).toBe("PT409");
    expect(err.message).toMatch(/illegal errand transition/);
  });

  it("rejects a transition whose ledger doesn't match held_amount, and writes nothing", async () => {
    const d = await step(await postErrand(), { type: "accept" }, helper(U.h1), T0);
    const t = apply(d, { type: "confirm_payment", providerRef: "tamper", amount: amountDue(d) }, { now: T0, actor: provider });
    const args = applyTransitionArgs(d, t, T0);
    args.p_deal = { ...args.p_deal, held_amount: args.p_deal.held_amount + 1 };
    const err = await sqlError(as(db, "service_role", null, (tx) => rpc(tx, "apply_transition", args)));
    expect(err.message).toMatch(/does not match held_amount/);
    expect(await loadDeal(db, d.id)).toEqual(d);
    expect(await scalar<number>(db, `select count(*)::int as v from public.ledger_entries where provider_ref = 'tamper'`)).toBe(0);
  });

  it("books one provider payment only once", async () => {
    const a = await pay(await matched(), T0, "same-ref");
    const b = await matched();
    const t = apply(b, { type: "confirm_payment", providerRef: "same-ref", amount: amountDue(b) }, { now: T0, actor: provider });
    const err = await sqlError(as(db, "service_role", null, (tx) => rpc(tx, "apply_transition", applyTransitionArgs(b, t, T0))));
    expect(err.message).toMatch(/duplicate key|unique/);
    expect(a.status).toBe("matched");
  });

  it("keeps the ledger append-only", async () => {
    await pay(await matched());
    expect((await sqlError(db.query(`update public.ledger_entries set amount = 1`))).message).toMatch(/append-only/);
    expect((await sqlError(db.query(`delete from public.ledger_entries`))).message).toMatch(/append-only/);
  });

  it("refuses closed deals that still hold money", async () => {
    const d = await pay(await matched());
    const err = await sqlError(db.query(`update public.deals set status = 'cancelled' where id = $1`, [d.id]));
    expect(err.message).toMatch(/closed_deals_hold_nothing/);
  });
});

describe("dispatch queries", () => {
  // Sükhbaatar Square; ~1 km and ~6 km away.
  const SQ = { lat: 47.9186, lng: 106.9177 };
  const presence = (uid: string, lat: number, lng: number, radius: number, online = true, ago = "1 minute") =>
    db.query(
      `insert into public.helper_presence (user_id, online, lat, lng, radius_km, updated_at)
       values ($1, $2, $3, $4, $5, now() - $6::interval)
       on conflict (user_id) do update set online = excluded.online, lat = excluded.lat, lng = excluded.lng,
         radius_km = excluded.radius_km, updated_at = excluded.updated_at`,
      [uid, online, lat, lng, radius, ago],
    );
  const candidates = (dealId: string, maxKm: number) =>
    as(db, "service_role", null, async (tx) =>
      (await tx.query<{ helper_id: string; distance_km: number }>(
        `select helper_id, distance_km from public.dispatch_candidates($1, $2)`,
        [dealId, maxKm],
      )).rows,
    );

  it("finds online, approved helpers in the category within both radii, with distance", async () => {
    await presence(U.h1, 47.9276, 106.9177, 5); // ~1 km north, will go 5 km
    await presence(U.h2, 47.9726, 106.9177, 3); // ~6 km north, only goes 3 km
    const d = await postErrand({ category: "shop", location: SQ });
    const near = await candidates(d.id, 2);
    expect(near.map((r) => r.helper_id)).toEqual([U.h1]);
    expect(near[0].distance_km).toBeGreaterThan(0.9);
    expect(near[0].distance_km).toBeLessThan(1.1);
    // h2 is 6 km away but only travels 3 km → never offered, even city-wide
    expect((await candidates(d.id, 1000)).map((r) => r.helper_id)).not.toContain(U.h2);
  });

  it("skips offline helpers, stale positions, other categories and the customer themself", async () => {
    const repair = await postErrand({ category: "repair", fee: 15000, location: SQ });
    await presence(U.h2, 47.9186, 106.9177, 10); // right there, but h2 only does shopping
    expect((await candidates(repair.id, 1000)).map((r) => r.helper_id)).not.toContain(U.h2);
    await presence(U.h1, 47.9186, 106.9177, 10, true, "11 minutes");
    expect(await candidates(repair.id, 1000)).toEqual([]);
    await presence(U.h1, 47.9186, 106.9177, 10, false);
    expect(await candidates(repair.id, 1000)).toEqual([]);
  });

  it("nearby feed lists open tasks nearest first; matched tasks disappear", async () => {
    await presence(U.h1, 47.9186, 106.9177, 10);
    const far = await postErrand({ title: "far", location: { lat: 47.9726, lng: 106.9177 } });
    const near = await postErrand({ title: "near", location: { lat: 47.9196, lng: 106.9177 } });
    const feed = () =>
      as(db, "service_role", null, async (tx) =>
        (await tx.query<{ deal_id: string }>(`select deal_id from public.nearby_open_deals($1)`, [U.h1])).rows.map((r) => r.deal_id),
      );
    const ids = await feed();
    expect(ids.indexOf(near.id)).toBeLessThan(ids.indexOf(far.id));
    await step(near, { type: "accept" }, helper(U.h1), T0);
    expect(await feed()).not.toContain(near.id);
  });

  it("stores the pickup pin and measures 'nearby' from it (the helper starts there)", async () => {
    // drop-off at the square, pickup ~6 km north; h1 sits next to the pickup with a 2 km radius
    const pickup = { lat: 47.9726, lng: 106.9177 };
    await presence(U.h1, 47.9736, 106.9177, 2);
    const d = await postErrand({ category: "shop", location: SQ, pickupLocation: pickup, fee: 15000 }); // round trip checks the columns
    expect(d.type === "errand" && d.pickupLocation).toEqual(pickup);
    expect(d.type === "errand" && d.details.km).toBeGreaterThan(7);
    const c = await candidates(d.id, 2);
    expect(c.map((r) => r.helper_id)).toEqual([U.h1]);
    expect(c[0].distance_km).toBeLessThan(0.2);
    const feed = await as(db, "service_role", null, async (tx) =>
      (await tx.query<{ deal_id: string; distance_km: number }>(`select deal_id, distance_km from public.nearby_open_deals($1)`, [U.h1])).rows,
    );
    expect(feed.find((r) => r.deal_id === d.id)?.distance_km).toBeLessThan(0.2);
    // half a pin is refused by the database
    const err = await sqlError(db.query(`update public.deals set pickup_lng = null where id = $1`, [d.id]));
    expect(err.message).toMatch(/deals_pickup_pin_pair/);
  });

  it("clients can't call the dispatch queries or read other helpers' presence", async () => {
    const err = await sqlError(as(db, "authenticated", U.h1, (tx) => tx.query(`select * from public.nearby_open_deals($1)`, [U.h1])));
    expect(err.message).toMatch(/permission denied/);
    const rows = await as(db, "authenticated", U.h2, async (tx) => (await tx.query(`select user_id from public.helper_presence`)).rows);
    expect(rows).toEqual([{ user_id: U.h2 }]);
  });
});

describe("proof storage", () => {
  it("creates a PRIVATE bucket and stores fingerprints; only participants read proof rows", async () => {
    expect(await scalar<boolean>(db, `select public as v from storage.buckets where id = 'proofs'`)).toBe(false);
    const d = await step(await postErrand({ itemBudget: 0 }), { type: "accept" }, helper(U.h1), T0);
    await as(db, "service_role", null, (tx) =>
      tx.query(
        `insert into public.proofs (deal_id, kind, file_path, mime, bytes, sha256, dhash, flags, uploaded_by)
         values ($1, 'handover', $2, 'image/jpeg', 1234, $3, 'a1b2c3d4e5f60718', '{similar_photo}', $4)`,
        [d.id, `${d.id}/handover-x.jpg`, "a".repeat(64), U.h1],
      ),
    );
    const read = (uid: string) =>
      as(db, "authenticated", uid, async (tx) => (await tx.query(`select flags from public.proofs where deal_id = $1`, [d.id])).rows);
    expect(await read(U.c1)).toEqual([{ flags: ["similar_photo"] }]); // customer
    expect(await read(U.h1)).toHaveLength(1); // assigned helper
    expect(await read(U.c2)).toEqual([]); // stranger
    const bad = await sqlError(
      as(db, "service_role", null, (tx) =>
        tx.query(`insert into public.proofs (deal_id, kind, sha256, uploaded_by) values ($1, 'receipt', 'nothex', $2)`, [d.id, U.h1]),
      ),
    );
    expect(bad.message).toMatch(/check constraint/);
  });
});

describe("chat privacy", () => {
  it("delivers a helper's question and the owner's reply on an open job without creating an application", async () => {
    const d = await postErrand({ itemBudget: 0 });
    const send = (from: string, text: string) => as(db, "service_role", null, tx => tx.query(
      `insert into public.messages (deal_id, helper_id, from_user_id, text, flags)
       values ($1, $2, $3, $4, '{inquiry}')`, [d.id, U.h1, from, text],
    ));
    await send(U.h1, "Does the parcel fit in a backpack?");
    const inbox = await as(db, "authenticated", U.c1, tx => tx.query(
      `select helper_id from public.messages where deal_id = $1 and flags @> '{inquiry}' and from_user_id <> $2 and seen_at is null`, [d.id, U.c1],
    ));
    expect(inbox.rows).toEqual([{ helper_id: U.h1 }]);
    await send(U.c1, "Yes, it is a paperback book.");
    const conversation = (who: string) => as(db, "authenticated", who, tx => tx.query(
      `select text from public.messages where deal_id = $1 and helper_id = $2 order by created_at`, [d.id, U.h1],
    ));
    expect((await conversation(U.h1)).rows).toHaveLength(2);
    expect((await conversation(U.h2)).rows).toEqual([]);
    expect(await scalar<number>(db, `select count(*)::int as v from public.offers where deal_id = $1`, [d.id])).toBe(0);
    expect(await scalar<string>(db, `select status as v from public.deals where id = $1`, [d.id])).toBe("open");
  });

  it("each helper sees only their own conversation; customer sees theirs; strangers and clients-writing are refused", async () => {
    const d = await postErrand({ itemBudget: 0 });
    const msg = (helperId: string, from: string, text: string) =>
      as(db, "service_role", null, (tx) =>
        tx.query(`insert into public.messages (deal_id, helper_id, from_user_id, text) values ($1, $2, $3, $4)`, [d.id, helperId, from, text]),
      );
    await msg(U.h1, U.c1, "to first helper");
    await msg(U.h1, U.h1, "from first helper");
    await msg(U.h2, U.c1, "to second helper");
    const read = (uid: string) =>
      as(db, "authenticated", uid, async (tx) =>
        (await tx.query<{ text: string }>(`select text from public.messages where deal_id = $1 order by created_at, text`, [d.id])).rows.map((r) => r.text),
      );
    expect(await read(U.c1)).toHaveLength(3); // the customer
    expect(await read(U.h1)).toEqual(expect.arrayContaining(["to first helper", "from first helper"]));
    expect(await read(U.h1)).not.toContain("to second helper");
    expect(await read(U.h2)).toEqual(["to second helper"]);
    expect(await read(U.c2)).toEqual([]); // stranger
    expect(await read(U.ops)).toEqual([]); // Ops only when disputed
    const write = await sqlError(
      as(db, "authenticated", U.c1, (tx) =>
        tx.query(`insert into public.messages (deal_id, helper_id, from_user_id, text) values ($1, $2, $3, 'x')`, [d.id, U.h1, U.c1]),
      ),
    );
    expect(write.message).toMatch(/permission denied/);
    const empty = await sqlError(msg(U.h1, U.c1, "   "));
    expect(empty.message).toMatch(/messages_has_content/);
  });
});

describe("call signal privacy", () => {
  it("only the two people on a call can read its signals; clients can't write; malformed signals are refused", async () => {
    const d = await postErrand({ itemBudget: 0 });
    const callId = "20000000-0000-4000-8000-000000000001";
    await as(db, "service_role", null, (tx) =>
      tx.query(
        `insert into public.call_signals (deal_id, call_id, from_user_id, to_user_id, kind, sdp) values ($1, $2, $3, $4, 'offer', 'v=0 test')`,
        [d.id, callId, U.c1, U.h1],
      ),
    );
    const seen = (uid: string) =>
      as(db, "authenticated", uid, async (tx) => (await tx.query(`select kind from public.call_signals where call_id = $1`, [callId])).rows.length);
    expect(await seen(U.c1)).toBe(1); // caller
    expect(await seen(U.h1)).toBe(1); // callee
    expect(await seen(U.h2)).toBe(0);
    expect(await seen(U.c2)).toBe(0);
    expect(await seen(U.ops)).toBe(0);
    const write = await sqlError(
      as(db, "authenticated", U.c1, (tx) =>
        tx.query(`insert into public.call_signals (deal_id, call_id, from_user_id, to_user_id, kind) values ($1, $2, $3, $4, 'hangup')`, [d.id, callId, U.c1, U.h1]),
      ),
    );
    expect(write.message).toMatch(/permission denied/);
    const bad = await sqlError(
      as(db, "service_role", null, (tx) =>
        tx.query(`insert into public.call_signals (deal_id, call_id, from_user_id, to_user_id, kind) values ($1, $2, $3, $4, 'offer')`, [d.id, callId, U.c1, U.h1]),
      ),
    );
    expect(bad.message).toMatch(/check constraint/); // an offer without SDP
  });
});

describe("saved helpers (♡)", () => {
  it("each customer reads only their own list; clients can't write it; no saving yourself", async () => {
    await as(db, "service_role", null, (tx) =>
      tx.query(`insert into public.saved_helpers (customer_id, helper_id) values ($1, $2), ($3, $2)`, [U.c1, U.h1, U.c2]),
    );
    const mine = await as(db, "authenticated", U.c1, async (tx) => (await tx.query<{ helper_id: string }>(`select helper_id from public.saved_helpers`)).rows);
    expect(mine).toEqual([{ helper_id: U.h1 }]); // c2's row stays invisible to c1
    const write = await sqlError(as(db, "authenticated", U.c1, (tx) => tx.query(`insert into public.saved_helpers (customer_id, helper_id) values ($1, $2)`, [U.c1, U.h2])));
    expect(write.message).toMatch(/permission denied/);
    const self = await sqlError(db.query(`insert into public.saved_helpers (customer_id, helper_id) values ($1, $1)`, [U.h1]));
    expect(self.message).toMatch(/saved_helpers_not_self/);
    const anon = await sqlError(as(db, "anon", null, (tx) => tx.query(`select * from public.saved_helpers`)));
    expect(anon.message).toMatch(/permission denied/);
  });
});

describe("helper verification data", () => {
  it("applications and bank accounts are server-only: not even the applicant can read them from a browser", async () => {
    await as(db, "service_role", null, async (tx) => {
      await tx.query(
        `insert into public.helper_applications (user_id, legal_name, id_last4, birth_date, categories, consent_at)
         values ($1, 'Solongo Bat', '1234', '1995-05-05', '{shop}', now())`,
        [U.c2],
      );
      await tx.query(`insert into public.payout_accounts (user_id, bank, account_number, holder_name) values ($1, 'Хаан банк', 'MN120005005005123456', 'Solongo Bat')`, [U.c2]);
    });
    for (const sql of [`select * from public.helper_applications`, `select * from public.payout_accounts`]) {
      for (const uid of [U.c2, U.h1]) {
        const err = await sqlError(as(db, "authenticated", uid, (tx) => tx.query(sql)));
        expect(err.message, `${uid} ${sql}`).toMatch(/permission denied/);
      }
    }
    // only one application waiting for review per person
    const dup = await sqlError(
      as(db, "service_role", null, (tx) =>
        tx.query(`insert into public.helper_applications (user_id, legal_name, id_last4, categories, consent_at) values ($1, 'Solongo Bat', '1234', '{shop}', now())`, [U.c2]),
      ),
    );
    expect(dup.message).toMatch(/duplicate key/);
    const badAcct = await sqlError(
      as(db, "service_role", null, (tx) =>
        tx.query(`update public.payout_accounts set account_number = 'ABC123' where user_id = $1`, [U.c2]),
      ),
    );
    expect(badAcct.message).toMatch(/check constraint/);
    expect(await scalar<boolean>(db, `select public as v from storage.buckets where id = 'kyc'`)).toBe(false);
  });
});

describe("safety controls", () => {
  const controls = (sql: string) => as(db, "service_role", null, (tx) => tx.query(`update public.platform_controls set ${sql}`));
  const reset = () =>
    controls(`posting_paused = false, payments_paused = false, max_deal_amount = 300000, max_customer_daily = 600000, max_total_held = 5000000`);
  const check = (deal: string, payer: string, amount: number) =>
    as(db, "service_role", null, async (tx) =>
      (await tx.query<{ v: string | null }>(`select public.payin_check($1, $2, $3) as v`, [deal, payer, amount])).rows[0].v,
    );

  it("payin_check: OK by default; refuses when paused or over a cap (per task, per customer per day, platform)", async () => {
    try {
      const d = await matched({ customerId: U.c2 });
      expect(await check(d.id, U.c2, 48000)).toBeNull();
      expect(await check(d.id, U.c2, 300001)).toBe("cap_deal");
      await controls(`payments_paused = true`);
      expect(await check(d.id, U.c2, 48000)).toBe("payments_paused");
      await controls(`payments_paused = false, max_customer_daily = 50000`);
      // a pay-in booked now (ledger time = now) counts towards today's limit
      await pay(d, Date.now());
      expect(await check(d.id, U.c2, 1000)).toBeNull();
      expect(await check(d.id, U.c2, 3000)).toBe("cap_daily");
      await controls(`max_customer_daily = 600000, max_total_held = 1`);
      expect(await check(d.id, U.c2, 1000)).toBe("cap_total");
    } finally {
      await reset();
    }
  });

  it("money freeze: a real pay-in is still booked, but nothing leaves the hold until it is lifted", async () => {
    try {
      let d = await matched();
      await controls(`payments_paused = true`);
      d = await pay(d, T0 + 90_000); // the bank said it arrived → recorded
      expect(d.heldAmount).toBe(48000);
      d = await step(d, { type: "start" }, helper(U.h1), T0 + 120_000);
      d = await step(d, { type: "record_receipt", amount: 35500 }, helper(U.h1), T0 + 180_000);
      d = await step(d, { type: "record_handover" }, helper(U.h1), T0 + 240_000);
      d = await step(d, { type: "finish" }, helper(U.h1), T0 + 300_000);
      const err = await sqlError(step(d, { type: "confirm" }, customer(U.c1), T0 + 360_000));
      expect(err.code).toBe("PT423");
      const still = await loadDeal(db, d.id);
      expect(still?.status).toBe("check");
      expect(still?.heldAmount).toBe(48000);
      await controls(`payments_paused = false`);
      d = await step(d, { type: "confirm" }, customer(U.c1), T0 + 360_000);
      expect(d.status).toBe("released");
      await noViolations();
    } finally {
      await reset();
    }
  });

  it("posting pause refuses new deals at the database", async () => {
    try {
      await controls(`posting_paused = true`);
      const err = await sqlError(postErrand());
      expect(err.code).toBe("PT423");
    } finally {
      await reset();
    }
  });

  it("controls, incidents and the Ops log are server-only; the log is append-only; one live SOS per person per task", async () => {
    const d = await matched();
    const sos = (status = "open") =>
      as(db, "service_role", null, (tx) =>
        tx.query(
          `insert into public.incidents (deal_id, reporter_id, subject_id, kind, status, ops_note, resolved_at)
           values ($1, $2, $3, 'sos', $4, $5, $6)`,
          [d.id, U.c1, U.h1, status, status === "resolved" ? "ok" : null, status === "resolved" ? new Date().toISOString() : null],
        ),
      );
    await sos();
    expect((await sqlError(sos())).message).toMatch(/duplicate key/);
    await as(db, "service_role", null, (tx) => tx.query(`update public.incidents set status = 'resolved', ops_note = 'Called, safe', resolved_at = now() where deal_id = $1`, [d.id]));
    await sos(); // a new SOS after the first was resolved is fine
    const unresolved = await sqlError(
      as(db, "service_role", null, (tx) => tx.query(`update public.incidents set status = 'resolved' where deal_id = $1 and status = 'open'`, [d.id])),
    );
    expect(unresolved.message).toMatch(/resolved_has_note/);

    await as(db, "service_role", null, (tx) => tx.query(`insert into public.ops_audit_log (actor_id, action, target) values ($1, 'controls.update', 'platform')`, [U.ops]));
    for (const sql of [`update public.ops_audit_log set action = 'x'`, `delete from public.ops_audit_log`, `delete from public.platform_controls`]) {
      const err = await sqlError(as(db, "service_role", null, (tx) => tx.query(sql)));
      expect(err.message, sql).toMatch(/append-only|single row/);
    }
    for (const sql of [
      `select * from public.platform_controls`,
      `select * from public.incidents`,
      `select * from public.ops_audit_log`,
      `insert into public.incidents (deal_id, reporter_id, kind) values ('${d.id}', '${U.c1}', 'other')`,
      `select public.payin_check('${d.id}', '${U.c1}', 1000)`,
    ]) {
      const err = await sqlError(as(db, "authenticated", U.c1, (tx) => tx.query(sql)));
      expect(err.message, sql).toMatch(/permission denied/);
    }
  });
});

describe("pricing (helpers keep 100%, flat service fee)", () => {
  it("a task at today's prices round-trips; release pays the helper the whole price", async () => {
    const id = dealId();
    const t = createErrand(
      { id, title: "Queue", description: "Hospital queue", category: "queue", mode: "now", address: "x", itemBudget: 0, fee: 14000, customerId: U.c1, details: { minutes: 120 } },
      { now: T0, actor: customer(U.c1) },
    );
    let d = await persist(null, t, T0);
    expect(d).toMatchObject({ serviceFee: 1500, commissionBps: 0 }); // 14,000₮ job total → 1,500₮ (V1 spec C4)
    expect(d.type === "errand" && d.details).toMatchObject({ minutes: 120, quotedFee: 14000, counterMax: 0 });
    // bargaining round-trips through the database: helper asks 18,000, customer 15,000, helper 16,000
    d = await step(d, { type: "apply", note: "", price: 18000 }, helper(U.h1), T0 + 1000);
    d = await step(d, { type: "counter", helperId: U.h1, price: 15000 }, customer(U.c1), T0 + 1200);
    expect(d.type === "errand" && d.offers[0]).toMatchObject({ price: 15000, proposedBy: "customer" });
    d = await step(d, { type: "reprice", price: 16000 }, helper(U.h1), T0 + 1500);
    d = await step(d, { type: "choose", helperId: U.h1 }, customer(U.c1), T0 + 2000);
    d = await pay(d, T0 + 3000);
    expect(d.heldAmount).toBe(17500);
    d = await step(d, { type: "start" }, helper(U.h1), T0 + 4000);
    d = await step(d, { type: "record_handover" }, helper(U.h1), T0 + 5000);
    d = await step(d, { type: "finish" }, helper(U.h1), T0 + 6000);
    d = await step(d, { type: "confirm" }, customer(U.c1), T0 + 7000);
    const bal = (acc: string) => scalar<string>(db, `select public.account_balance($1, $2)::text as v`, [acc, d.id]);
    expect(await bal(`payable:${U.h1}`)).toBe("16000");
    expect(await bal("platform")).toBe("1500");
    await noViolations();
  });

  it("a price change after matching round-trips: refund when lower, extra pay-in when higher", async () => {
    let d = await persist(
      null,
      createErrand(
        { id: dealId(), title: "Move", description: "Boxes", category: "carry", mode: "now", address: "x", itemBudget: 0, fee: 10000, customerId: U.c1 },
        { now: T0, actor: customer(U.c1) },
      ),
      T0,
    );
    d = await step(d, { type: "apply", note: "" }, helper(U.h1), T0 + 1000);
    d = await step(d, { type: "choose", helperId: U.h1 }, customer(U.c1), T0 + 2000);
    d = await pay(d, T0 + 3000);
    d = await step(d, { type: "propose_price", price: 8000 }, helper(U.h1), T0 + 4000);
    expect(d.type === "errand" && d.priceChange).toMatchObject({ fee: 8000, by: "helper", status: "proposed" });
    d = await step(d, { type: "answer_price", accept: true }, customer(U.c1), T0 + 5000);
    expect(d).toMatchObject({ fee: 8000, heldAmount: 9500 });
    d = await step(d, { type: "propose_price", price: 12000 }, customer(U.c1), T0 + 6000);
    d = await step(d, { type: "answer_price", accept: true }, helper(U.h1), T0 + 7000);
    d = await step(d, { type: "confirm_price", providerRef: `pc-${d.id}`, amount: 4000 }, provider, T0 + 8000);
    expect(d).toMatchObject({ fee: 12000, heldAmount: 13500 });
    expect(d.type === "errand" && d.priceChange).toMatchObject({ status: "paid", providerRef: `pc-${d.id}` });
    await noViolations(); // ledger hold == held_amount, sums intact
  });

  it("settings are one server-only row whose defaults match the engine", async () => {
    const row = await as(db, "service_role", null, async (tx) => (await tx.query<Record<string, unknown>>(`select * from public.pricing_settings`)).rows);
    expect(row).toHaveLength(1);
    expect(row[0]).toMatchObject({ base_fee: 5000, per_half_hour: 3000, per_km: 1500, heavy_fee: 3000, tools_fee: 2000, night_fee: 1000, price_down_bps: 2000, price_up_bps: 3000 });
    expect(row[0].service_fee_tiers).toEqual(DEFAULT_CONFIG.serviceFeeTiers);
    const bad = await sqlError(as(db, "service_role", null, (tx) => tx.query(`update public.pricing_settings set price_down_bps = 9000`)));
    expect(bad.message).toMatch(/check constraint/);
    expect((await sqlError(as(db, "service_role", null, (tx) => tx.query(`delete from public.pricing_settings`)))).message).toMatch(/single row/);
    const err = await sqlError(as(db, "authenticated", U.c1, (tx) => tx.query(`select * from public.pricing_settings`)));
    expect(err.message).toMatch(/permission denied/);
  });
});

describe("scheduler lease", () => {
  it("only one runner holds the lease until it expires or is released; clients can't touch it", async () => {
    const lease = (n: string, secs: number) =>
      as(db, "service_role", null, async (tx) => (await tx.query<{ v: boolean }>(`select public.try_lease($1, $2) as v`, [n, secs])).rows[0].v);
    expect(await lease("t1", 30)).toBe(true);
    expect(await lease("t1", 30)).toBe(false); // second runner refused
    await as(db, "service_role", null, (tx) => tx.query(`select public.release_lease('t1')`));
    expect(await lease("t1", 30)).toBe(true); // free again
    expect(await lease("t2", 0)).toBe(true);
    expect(await lease("t2", 30)).toBe(true); // a 0-second lease has already expired
    for (const sql of [`select public.try_lease('x', 30)`, `select public.configure_scheduler('https://a.b/api/cron/tick', repeat('s', 40))`, `select * from public.system_heartbeats`]) {
      const err = await sqlError(as(db, "authenticated", U.c1, (tx) => tx.query(sql)));
      expect(err.message, sql).toMatch(/permission denied/);
    }
  });
});

describe("send SMS hook (mock OTP)", () => {
  const event = (phone: string, otp: string) => JSON.stringify({ user: { phone }, sms: { otp } });

  it("records the code instead of sending, and only the server can read it back", async () => {
    const res = await as(db, "supabase_auth_admin", null, (tx) =>
      tx.query<{ r: unknown }>(`select public.send_sms_hook($1::jsonb) as r`, [event("97688000077", "654321")]),
    );
    expect(res.rows[0].r).toEqual({});

    const code = await as(db, "service_role", null, (tx) =>
      scalar<string>(tx, `select public.dev_latest_sms_code($1) as v`, ["+97688000077"]),
    );
    expect(code).toBe("654321");
  });

  it("returns a hook error for a malformed payload", async () => {
    const res = await as(db, "supabase_auth_admin", null, (tx) =>
      tx.query<{ r: { error?: { http_code: number } } }>(`select public.send_sms_hook($1::jsonb) as r`, ['{"user":{}}']),
    );
    expect(res.rows[0].r.error?.http_code).toBe(400);
  });

  it("users cannot call the hook or read codes", async () => {
    for (const role of ["authenticated", "anon"] as const) {
      const a = await sqlError(
        as(db, role, U.c1, (tx) => tx.query(`select public.send_sms_hook($1::jsonb)`, [event("97688000001", "1")])),
      );
      expect(a.message).toMatch(/permission denied/);
      const b = await sqlError(as(db, role, U.c1, (tx) => tx.query(`select public.dev_latest_sms_code('97688000077')`)));
      expect(b.message).toMatch(/permission denied/);
      const c = await sqlError(as(db, role, U.c1, (tx) => tx.query(`select * from private.sms_outbox`)));
      expect(c.message).toMatch(/permission denied/);
    }
  });
});

describe("row level security", () => {
  let open: Deal;
  let taken: Deal;
  beforeAll(async () => {
    open = await postErrand({ title: "open repair", category: "repair", fee: 15000 });
    taken = await step(await postErrand({ title: "taken shopping" }), { type: "accept" }, helper(U.h2, ["shop"]), T0);
  });

  const visibleDeals = (userId: string) =>
    as(db, "authenticated", userId, async (tx) =>
      (await tx.query<{ id: string }>(`select id from public.deals`)).rows.map((r) => r.id),
    );

  it("customers see their own deals, not other people's", async () => {
    expect(await visibleDeals(U.c1)).toEqual(expect.arrayContaining([taken.id, open.id]));
    const c2 = await visibleDeals(U.c2);
    expect(c2).not.toContain(taken.id);
    expect(c2).not.toContain(open.id);
  });

  it("helpers can't read open tasks (exact pins, addresses) through the API — only tasks they took", async () => {
    // the feed is served by server code, which shows a ~300 m area until a helper is matched
    const applied = await step(await postErrand({ title: "applied", category: "repair", fee: 15000, location: { lat: 47.9186, lng: 106.9177 } }), { type: "apply", note: "" }, helper(U.h1), T0);
    const h1 = await visibleDeals(U.h1); // approved, all categories
    expect(h1).not.toContain(open.id);
    expect(h1).not.toContain(applied.id); // applying doesn't reveal the exact pin either
    expect(h1).not.toContain(taken.id);
    expect(await visibleDeals(U.h2)).toContain(taken.id); // the matched helper sees their task
    const raw = await as(db, "authenticated", U.h1, async (tx) =>
      (await tx.query(`select lat, lng, address, pickup_lat from public.deals where id = $1`, [applied.id])).rows,
    );
    expect(raw).toEqual([]);
  });

  it("anonymous users see nothing", async () => {
    const err = await sqlError(as(db, "anon", null, (tx) => tx.query(`select id from public.deals`)));
    expect(err.message).toMatch(/permission denied/);
  });

  it("clients cannot write deals or the ledger, or promote themselves", async () => {
    for (const sql of [
      `insert into public.deals (type, title, check_hours) values ('goods', 'x', 24)`,
      `insert into public.ledger_entries (kind, amount, from_account, to_account) values ('refund', 1, 'platform', 'platform')`,
      `update public.profiles set role = 'admin' where id = '${U.c1}'`,
      `update public.deals set held_amount = 0`,
    ]) {
      const err = await sqlError(as(db, "authenticated", U.c1, (tx) => tx.query(sql)));
      expect(err.message, sql).toMatch(/permission denied/);
    }
  });

  it("users can edit their own name, and only their own", async () => {
    await as(db, "authenticated", U.c1, (tx) => tx.query(`update public.profiles set name = 'Solongo B.' where id = $1`, [U.c1]));
    const n = await as(db, "authenticated", U.c1, (tx) =>
      tx.query(`update public.profiles set name = 'hacked' where id = $1`, [U.c2]),
    );
    expect(n.affectedRows).toBe(0);
    expect(await scalar<string>(db, `select name as v from public.profiles where id = $1`, [U.c1])).toBe("Solongo B.");
  });

  it("saved addresses: owners manage their own; nobody else can read or write them", async () => {
    await as(db, "authenticated", U.c1, (tx) =>
      tx.query(`insert into public.saved_addresses (kind, address, floor, lift) values ('home', '3-р хороо, 12-р байр', 5, 'no')`),
    );
    // one Home per person
    const dup = await sqlError(
      as(db, "authenticated", U.c1, (tx) => tx.query(`insert into public.saved_addresses (kind, address) values ('home', 'x')`)),
    );
    expect(dup.message).toMatch(/duplicate key/);
    // cannot plant a row on someone else
    const forged = await sqlError(
      as(db, "authenticated", U.c1, (tx) =>
        tx.query(`insert into public.saved_addresses (user_id, kind, address) values ($1, 'work', 'x')`, [U.c2]),
      ),
    );
    expect(forged.message).toMatch(/row-level security/);
    const seen = (uid: string) =>
      as(db, "authenticated", uid, async (tx) => (await tx.query(`select address from public.saved_addresses`)).rows.length);
    expect(await seen(U.c1)).toBe(1);
    expect(await seen(U.c2)).toBe(0);
    expect(await seen(U.h1)).toBe(0);
    const del = await as(db, "authenticated", U.c2, (tx) => tx.query(`delete from public.saved_addresses`));
    expect(del.affectedRows).toBe(0);
  });

  it("ledger: users see only their own accounts; Ops sees everything", async () => {
    const count = (uid: string) =>
      as(db, "authenticated", uid, async (tx) => scalar<number>(tx, `select count(*)::int as v from public.ledger_entries`));
    const total = await scalar<number>(db, `select count(*)::int as v from public.ledger_entries`);
    expect(await count(U.ops)).toBe(total);
    expect(await count(U.c2)).toBeLessThan(total);
    const leaked = await as(db, "authenticated", U.c2, (tx) =>
      tx.query(
        `select 1 from public.ledger_entries where not (from_account like $1 or to_account like $1)`,
        [`%${U.c2}`],
      ),
    );
    expect(leaked.rows).toEqual([]);
  });

  it("anyone signed in can read trust-card fields, but never phone, ДАН name or payout", async () => {
    const pub = await as(db, "authenticated", U.c1, (tx) =>
      tx.query<Record<string, unknown>>(`select * from public.public_profiles where id = $1`, [U.h1]),
    );
    expect(pub.rows).toHaveLength(1);
    expect(pub.rows[0]).toMatchObject({ id: U.h1, role: "helper", helper_status: "approved" });
    expect(pub.rows[0]).not.toHaveProperty("phone");

    for (const col of ["phone", "verified_name", "payout_holder_name", "payout_account_last4", "suspended_until"]) {
      const err = await sqlError(
        as(db, "authenticated", U.c1, (tx) => tx.query(`select ${col} from public.profiles where id = $1`, [U.c1])),
      );
      expect(err.message, col).toMatch(/permission denied/);
    }
    // even `select *` is refused rather than silently leaking
    expect((await sqlError(as(db, "authenticated", U.c1, (tx) => tx.query(`select * from public.profiles`)))).message).toMatch(
      /permission denied/,
    );
  });

  it("clients cannot call the write functions", async () => {
    const err = await sqlError(
      as(db, "authenticated", U.c1, (tx) => rpc(tx, "insert_deal", { p_deal: {}, p_events: [] })),
    );
    expect(err.message).toMatch(/permission denied/);
  });
});

describe("listings and direct requests (20261116040000)", () => {
  const feed = (uid: string) =>
    as(db, "service_role", null, async (tx) =>
      (await tx.query<{ deal_id: string }>(`select deal_id from public.nearby_open_deals($1)`, [uid])).rows.map((r) => r.deal_id),
    );

  it("a direct request round-trips; only the invited helper sees it in the feed until it opens", async () => {
    await db.query(
      `insert into public.helper_presence (user_id, online, lat, lng, radius_km, updated_at) values ($1, true, 47.9186, 106.9177, 10, now()), ($2, true, 47.9186, 106.9177, 10, now())
       on conflict (user_id) do update set online = true, lat = excluded.lat, lng = excluded.lng, radius_km = 10, updated_at = now()`,
      [U.h1, U.h2],
    );
    const now = Date.now();
    const d = await postErrand({ category: "shop", location: { lat: 47.92, lng: 106.92 }, invite: { helperId: U.h2, openAfter: true } }, now);
    expect(d.type === "errand" && d.invite).toMatchObject({ helperId: U.h2, openAfter: true });
    expect(await feed(U.h2)).toContain(d.id);
    expect(await feed(U.h1)).not.toContain(d.id);
    // h2 says no → the request ends and the task opens to everyone (apply_transition writes invite_until)
    const opened = await step(d, { type: "decline_invite" }, helper(U.h2, ["shop"]), now);
    expect(opened.status).toBe("open");
    expect(await feed(U.h1)).toContain(d.id);

    const only = await postErrand({ category: "shop", invite: { helperId: U.h2, openAfter: false } }, now);
    expect(await feed(U.h1)).not.toContain(only.id);
    const ended = await step(only, { type: "decline_invite" }, helper(U.h2, ["shop"]), now);
    expect(ended.status).toBe("expired");
  });

  it("the database refuses a request to someone who isn't an approved helper for that kind of task, or to yourself", async () => {
    const t = (helperId: string, category: NewErrandInput["category"]) =>
      createErrand(
        { id: dealId(), title: "T", description: "D", category, mode: "now", address: "A", itemBudget: 0, fee: 9000, customerId: U.c1, invite: { helperId, openAfter: true } },
        { now: T0, actor: customer(U.c1) },
        TEST_CONFIG,
      );
    for (const bad of [t(U.c2, "shop"), t(U.h2, "repair")]) {
      const err = await sqlError(as(db, "service_role", null, (tx) => rpc(tx, "insert_deal", insertDealArgs(bad))));
      expect(err.message).toMatch(/invited helper must be an approved helper/);
    }
    const mine = await postErrand({ category: "shop" });
    const self = await sqlError(db.query(`update public.deals set invited_helper_id = customer_id, invite_until = now() where id = $1`, [mine.id]));
    expect(self.message).toMatch(/deals_invite_not_self/);
  });

  it("intro and 'from' price are public trust-card fields that only the server writes", async () => {
    const bio = await sqlError(db.query(`update public.profiles set bio = repeat('x', 501) where id = $1`, [U.h1]));
    expect(bio.message).toMatch(/profiles_bio_check/);
    const price = await sqlError(db.query(`update public.profiles set from_price = 500 where id = $1`, [U.h1]));
    expect(price.message).toMatch(/profiles_from_price_check/);
    await db.query(`update public.profiles set bio = 'Машинтай', from_price = 8000 where id = $1`, [U.h1]);
    const seen = await as(db, "authenticated", U.c1, (tx) => tx.query(`select bio, from_price from public.profiles where id = $1`, [U.h1]));
    expect(seen.rows).toEqual([{ bio: "Машинтай", from_price: 8000 }]);
    const write = await sqlError(as(db, "authenticated", U.h1, (tx) => tx.query(`update public.profiles set bio = 'x' where id = $1`, [U.h1])));
    expect(write.message).toMatch(/permission denied/);
  });

  it("quick starts and search words are seeded, checked, and server-only", async () => {
    const pop = await scalar<number>(db, `select count(*)::int as v from public.quick_starts where kind = 'popular' and active`);
    const winter = await scalar<number>(db, `select count(*)::int as v from public.quick_starts where kind = 'seasonal' and 11 = any (months)`);
    expect(pop).toBe(5);
    expect(winter).toBe(5);
    const words = await db.query<{ category: string; word: string }>(`select category, word from public.category_keywords`);
    const byCat: Record<string, string[]> = {};
    for (const r of words.rows) (byCat[r.category] ??= []).push(r.word);
    const { guessCategory } = await import("@/lib/category-guess");
    expect(guessCategory("Буйдан зөөх", byCat)).toBe("carry");
    expect(guessCategory("Бичиг баримт хүргэх", byCat)).toBe("deliver");
    expect(guessCategory("эм авах", byCat)).toBe("shop");

    const month = await sqlError(db.query(`insert into public.quick_starts (kind, category, title_mn, title_en, months) values ('seasonal', 'shop', 'Тест', 'Test', '{13}')`));
    expect(month.message).toMatch(/quick_starts_months_check/);
    const upper = await sqlError(db.query(`insert into public.category_keywords (category, word) values ('shop', 'Талх')`));
    expect(upper.message).toMatch(/category_keywords_word_check/);
    for (const table of ["quick_starts", "category_keywords"]) {
      for (const role of ["authenticated", "anon"] as const) {
        const err = await sqlError(as(db, role, role === "anon" ? null : U.c1, (tx) => tx.query(`select * from public.${table}`)));
        expect(err.message, `${role} ${table}`).toMatch(/permission denied/);
      }
    }
  });
});
