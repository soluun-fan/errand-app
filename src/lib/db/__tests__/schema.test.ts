import type { PGlite, Transaction } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { actorFromProfile, applyTransitionArgs, insertDealArgs, type ProfileRow } from "@/lib/db/mapping";
import {
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

  it("a match not paid in 10 min reopens the task: fee, pay_by and the dropped offer persist", async () => {
    let d = await postErrand({ mode: "schedule", scheduledAt: T0 + 30 * HOUR_MS, itemBudget: 0, location: { lat: 47.9184, lng: 106.9177 } });
    expect(d.type === "errand" && d.location).toEqual({ lat: 47.9184, lng: 106.9177 });
    d = await step(d, { type: "apply", note: "quote", price: 20000 }, helper(U.h1), T0 + 1000);
    d = await step(d, { type: "choose", helperId: U.h1 }, customer(U.c1), T0 + 2000);
    expect(d).toMatchObject({ status: "awaiting_payment", fee: 20000 });
    const later = T0 + 2000 + 10 * 60_000;
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

  it("helper cancel suspends the helper for 3 days", async () => {
    let d = await postErrand({ itemBudget: 0 });
    d = await step(d, { type: "accept" }, helper(U.h2, ["shop"]), T0);
    d = await pay(d);
    d = await step(d, { type: "cancel" }, helper(U.h2, ["shop"]), T0 + 1000);
    expect(d.status).toBe("cancelled");
    const p = await db.query<ProfileRow>(
      `select id, name, phone, role, kyc_level, helper_status, verified_name, categories, area,
              to_jsonb(suspended_until) #>> '{}' as suspended_until
       from public.profiles where id = $1`,
      [U.h2],
    );
    const prof = { ...p.rows[0], categories: ["shop" as const] };
    expect(Date.parse(prof.suspended_until as string)).toBe(T0 + 1000 + 3 * 86_400_000);
    expect(actorFromProfile(prof, T0 + 2 * 86_400_000).helperApproved).toBe(false);
    expect(actorFromProfile(prof, T0 + 4 * 86_400_000).helperApproved).toBe(true);
    // clean up so later tests can use h2
    await db.query(`update public.profiles set suspended_until = null where id = $1`, [U.h2]);
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

  it("clients can't call the dispatch queries or read other helpers' presence", async () => {
    const err = await sqlError(as(db, "authenticated", U.h1, (tx) => tx.query(`select * from public.nearby_open_deals($1)`, [U.h1])));
    expect(err.message).toMatch(/permission denied/);
    const rows = await as(db, "authenticated", U.h2, async (tx) => (await tx.query(`select user_id from public.helper_presence`)).rows);
    expect(rows).toEqual([{ user_id: U.h2 }]);
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

  it("approved helpers see open tasks in their categories; a matched task leaves the feed", async () => {
    const h1 = await visibleDeals(U.h1); // all categories
    expect(h1).toContain(open.id);
    expect(h1).not.toContain(taken.id); // matched to h2 → gone from everyone else's feed
    expect(await visibleDeals(U.h2)).not.toContain(open.id); // h2 only does shopping
    expect(await visibleDeals(U.h2)).toContain(taken.id); // ...but sees the task they took
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
