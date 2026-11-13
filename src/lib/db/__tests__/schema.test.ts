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
    d = await pay(d);
    d = await step(d, { type: "accept" }, helper(U.h1), T0 + 60_000);
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

  it("scheduled errand: offers are stored and reloaded in order", async () => {
    let d = await postErrand({ mode: "schedule", scheduledAt: T0 + 30 * HOUR_MS, itemBudget: 0 });
    d = await pay(d);
    d = await step(d, { type: "apply", note: "first" }, helper(U.h1), T0 + 1000);
    d = await step(d, { type: "apply", note: "second" }, helper(U.h2, ["shop"]), T0 + 2000);
    d = await step(d, { type: "choose", helperId: U.h2 }, customer(U.c1), T0 + 3000);
    expect(d.type === "errand" && d.offers.map((o) => o.note)).toEqual(["first", "second"]);
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

  it("helper cancel suspends the helper for 3 days", async () => {
    let d = await postErrand({ itemBudget: 0 });
    d = await pay(d);
    d = await step(d, { type: "accept" }, helper(U.h2, ["shop"]), T0);
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
    let d = await postErrand();
    d = await pay(d);
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
    const d = await postErrand();
    const t = apply(d, { type: "confirm_payment", providerRef: "tamper", amount: amountDue(d) }, { now: T0, actor: provider });
    const args = applyTransitionArgs(d, t, T0);
    args.p_deal = { ...args.p_deal, held_amount: args.p_deal.held_amount + 1 };
    const err = await sqlError(as(db, "service_role", null, (tx) => rpc(tx, "apply_transition", args)));
    expect(err.message).toMatch(/does not match held_amount/);
    expect(await loadDeal(db, d.id)).toEqual(d);
    expect(await scalar<number>(db, `select count(*)::int as v from public.ledger_entries where provider_ref = 'tamper'`)).toBe(0);
  });

  it("books one provider payment only once", async () => {
    const a = await pay(await postErrand(), T0, "same-ref");
    const b = await postErrand();
    const t = apply(b, { type: "confirm_payment", providerRef: "same-ref", amount: amountDue(b) }, { now: T0, actor: provider });
    const err = await sqlError(as(db, "service_role", null, (tx) => rpc(tx, "apply_transition", applyTransitionArgs(b, t, T0))));
    expect(err.message).toMatch(/duplicate key|unique/);
    expect(a.status).toBe("open");
  });

  it("keeps the ledger append-only", async () => {
    await pay(await postErrand());
    expect((await sqlError(db.query(`update public.ledger_entries set amount = 1`))).message).toMatch(/append-only/);
    expect((await sqlError(db.query(`delete from public.ledger_entries`))).message).toMatch(/append-only/);
  });

  it("refuses closed deals that still hold money", async () => {
    const d = await pay(await postErrand());
    const err = await sqlError(db.query(`update public.deals set status = 'cancelled' where id = $1`, [d.id]));
    expect(err.message).toMatch(/closed_deals_hold_nothing/);
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
  let unpaid: Deal;
  beforeAll(async () => {
    unpaid = await postErrand({ title: "unpaid", category: "repair" });
    open = await pay(await postErrand({ title: "open repair", category: "repair" }));
  });

  const visibleDeals = (userId: string) =>
    as(db, "authenticated", userId, async (tx) =>
      (await tx.query<{ id: string }>(`select id from public.deals`)).rows.map((r) => r.id),
    );

  it("customers see their own deals, not other people's", async () => {
    expect(await visibleDeals(U.c1)).toEqual(expect.arrayContaining([unpaid.id, open.id]));
    const c2 = await visibleDeals(U.c2);
    expect(c2).not.toContain(unpaid.id);
    expect(c2).not.toContain(open.id);
  });

  it("approved helpers see paid open tasks in their categories only", async () => {
    const h1 = await visibleDeals(U.h1); // all categories
    expect(h1).toContain(open.id);
    expect(h1).not.toContain(unpaid.id); // not paid yet
    expect(await visibleDeals(U.h2)).not.toContain(open.id); // h2 only does shopping
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
