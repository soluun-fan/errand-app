import { type PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyTransitionArgs, insertDealArgs } from "@/lib/db/mapping";
import { CATEGORIES, amountDue, apply, categoryTrust, createErrand, type CategoryId, type Command, type ErrandDeal, type Transition, type UserActor } from "@/lib/engine";
import { as, createTestDb, loadDeal, rpc, sqlError } from "./pg";

const customerId = "00000000-0000-4000-8000-000000000001";
const helperId = "00000000-0000-4000-8000-000000000002";
const orgId = "00000000-0000-4000-8000-000000000003";
const customer: UserActor = { kind: "user", id: customerId, role: "customer" };
const worker = (category: CategoryId): UserActor => ({ kind: "user", id: helperId, role: "helper", helperApproved: true, categories: ["shop"], qualified: [{ category, orgId }] });
let db: PGlite;
let now: number;

beforeAll(async () => {
  db = await createTestDb();
  for (const id of [customerId, helperId]) await db.query("insert into auth.users (id, phone) values ($1, $2)", [id, `9768800000${id.slice(-1)}`]);
  await db.query("insert into public.organizations(id, name, reg_number, kind, owner_id, categories, requested_categories, status) values ($1, 'Test agency', '1234567', 'agency', $2, '{plumbing,childcare}', '{plumbing,childcare}', 'approved')", [orgId, customerId]);
  await db.query("insert into public.org_members(org_id, helper_id, categories, status) values ($1, $2, '{plumbing,childcare}', 'active')", [orgId, helperId]);
  // a worker needs a bank account to work (migration 20261118050000)
  await db.query("insert into public.payout_accounts (user_id, bank, account_number, holder_name) values ($1, 'Хаан банк', '5012345678', 'Test Helper')", [helperId]);
});
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  now = Date.now();
  await db.query("update public.profiles set role = 'helper', helper_status = 'approved', kyc_level = 4, suspended_until = null, categories = '{shop}' where id = $1", [helperId]);
  await db.query("update public.organizations set kind = 'agency', status = 'approved', categories = '{plumbing,childcare}' where id = $1", [orgId]);
  await db.query("update public.org_members set status = 'active', categories = '{plumbing,childcare}' where org_id = $1", [orgId]);
  await db.exec("delete from public.helper_certificates; update public.category_settings set live = trust <> 'care';");
});

async function allowed(category: CategoryId, via: string | null = orgId, at = new Date(now).toISOString()) {
  const r = await db.query<{ ok: boolean }>("select private.can_take_via($1, $2, $3, $4) as ok", [helperId, category, via, at]);
  return r.rows[0].ok;
}
/** Tomorrow 10:00 in Ulaanbaatar — care work is daytime only, whatever time the tests run. */
const tomorrowAt10 = () => (Math.floor((now + 8 * 3_600_000) / 86_400_000) + 1) * 86_400_000 + 2 * 3_600_000;
function post(category: CategoryId = "plumbing", invite = false) {
  const scheduledAt = categoryTrust(category) === "care" ? tomorrowAt10() : null;
  return createErrand({ id: crypto.randomUUID(), title: "Fix tap", description: "Leaking", category, mode: "now", scheduledAt, address: "Test", customerId, fee: 10_000, itemBudget: 0, invite: invite ? { helperId, openAfter: true } : null }, { now, actor: customer });
}
async function persist(before: ErrandDeal | null, t: Transition) {
  await as(db, "service_role", null, (tx) => rpc(tx, before ? "apply_transition" : "insert_deal", before ? applyTransitionArgs(before, t, now) : insertDealArgs(t)));
  const reloaded = await loadDeal(db, t.deal.id) as ErrandDeal;
  expect(reloaded).toEqual(t.deal);
  return reloaded;
}
async function step(d: ErrandDeal, cmd: Command, actor: UserActor | { kind: "provider" }) {
  return persist(d, apply(d, cmd, { now, actor }));
}

it("database trust levels and care defaults agree with the engine", async () => {
  const { rows } = await db.query<{ category: CategoryId; trust: string; live: boolean }>("select category, trust, live from public.category_settings");
  expect(rows).toHaveLength(CATEGORIES.length);
  for (const c of CATEGORIES) expect(rows.find((r) => r.category === c.id)).toEqual({ category: c.id, trust: c.trust, live: c.trust !== "care" });
});

it("blocks posting disabled categories, including a forged care auto-pick setting", async () => {
  const off = await sqlError(persist(null, post("childcare")));
  expect(off.message).toMatch(/not available/);
  await db.exec("update public.category_settings set live = true where category = 'childcare'");
  const care = post("childcare"); care.deal.details.autoPick = true;
  expect((await sqlError(persist(null, care))).message).toMatch(/care_manual_choice/);
  await persist(null, post("childcare"));
});

it("closing care blocks new posts, applications and selection on older open posts", async () => {
  await db.exec("update public.category_settings set live = true where category = 'childcare'");
  const empty = await persist(null, post("childcare"));
  const applied = await step(await persist(null, post("childcare")), { type: "apply", note: "" }, worker("childcare"));
  await db.query("insert into public.messages (deal_id, helper_id, from_user_id, is_system, text) values ($1,$2,$3,true,'call:ended:voice:50')", [applied.id, helperId, customerId]);
  await db.exec("update public.category_settings set live = false where trust = 'care'");
  for (const category of ["childcare", "eldercare"] as const) {
    expect((await sqlError(persist(null, post(category)))).message).toMatch(/not available/);
  }
  expect((await sqlError(step(empty, { type: "apply", note: "" }, worker("childcare")))).message).toMatch(/not available/);
  expect((await sqlError(step(applied, { type: "choose", helperId }, customer))).message).toMatch(/not available/);
  expect((await step(applied, { type: "cancel" }, customer)).status).toBe("cancelled");
});

it("care requires an active agency and background-checked approved helper", async () => {
  expect(await allowed("childcare")).toBe(true);
  await db.query("update public.profiles set kyc_level = 3 where id = $1", [helperId]);
  expect(await allowed("childcare")).toBe(false);
  expect(await allowed("plumbing")).toBe(true);
  await db.query("update public.profiles set kyc_level = 4, suspended_until = now() + interval '1 day' where id = $1", [helperId]);
  expect(await allowed("plumbing")).toBe(false);
  await db.query("update public.profiles set suspended_until = null, helper_status = 'pending' where id = $1", [helperId]);
  expect(await allowed("childcare")).toBe(false);
  expect((await sqlError(db.query("update public.organizations set kind = 'company' where id = $1", [orgId]))).message).toMatch(/care_agency/);
});

it.each(["invited", "declined", "removed"])("a %s membership cannot qualify a worker", async (status) => {
  await db.query("update public.org_members set status = $1 where org_id = $2", [status, orgId]);
  expect(await allowed("plumbing")).toBe(false);
});

it("individual certificates expire at the UB calendar-day boundary; care clearance needs the background check", async () => {
  await db.query("insert into public.helper_certificates(helper_id, category, issuer, doc_path, status, expires_on) values ($1, 'electrical', 'Trade body', 'private.pdf', 'approved', '2026-11-17')", [helperId]);
  expect(await allowed("electrical", null, "2026-11-17T15:59:59Z")).toBe(true);
  expect(await allowed("electrical", null, "2026-11-17T16:00:00Z")).toBe(false);
  expect((await sqlError(db.query("insert into public.helper_certificates(helper_id, category, issuer, doc_path) values ($1, 'shop', 'x', 'private.pdf')", [helperId]))).message).toMatch(/pro or care/);
  // care clearance: only after the criminal-record check, and it stops counting if that level drops
  await db.query("update public.profiles set kyc_level = 3 where id = $1", [helperId]);
  expect((await sqlError(db.query("insert into public.helper_certificates(helper_id, category, issuer, doc_path) values ($1, 'childcare', 'Ops interview', 'private.pdf')", [helperId]))).message).toMatch(/criminal-record/);
  await db.query("update public.profiles set kyc_level = 4 where id = $1", [helperId]);
  await db.query("insert into public.helper_certificates(helper_id, category, issuer, doc_path, status) values ($1, 'childcare', 'Ops interview', 'private.pdf', 'approved')", [helperId]);
  expect(await allowed("childcare", null)).toBe(true);
  await db.query("update public.profiles set kyc_level = 3 where id = $1", [helperId]);
  expect(await allowed("childcare", null)).toBe(false);
});

it("certification, organisation and worker category scopes must all match", async () => {
  expect(await allowed("electrical")).toBe(false);
  await db.query("update public.org_members set categories = '{electrical}' where org_id = $1", [orgId]);
  expect(await allowed("plumbing")).toBe(false);
  expect(await allowed("electrical")).toBe(false);
});

it("specialized direct invites, dispatch and nearby jobs use qualifications instead of signup categories", async () => {
  const d = await persist(null, post("plumbing", true));
  await db.query("insert into public.helper_presence(user_id, online, radius_km, updated_at) values ($1, true, 60, now()) on conflict(user_id) do update set online = true, updated_at = now()", [helperId]);
  expect((await db.query("select helper_id from public.qualified_helper_ids('plumbing')")).rows).toEqual([{ helper_id: helperId }]);
  expect((await db.query("select helper_id from public.dispatch_candidates($1, 1000)", [d.id])).rows).toContainEqual({ helper_id: helperId });
  expect((await db.query("select deal_id from public.nearby_open_deals($1)", [helperId])).rows).toContainEqual({ deal_id: d.id });
  await db.query("update public.organizations set status = 'suspended' where id = $1", [orgId]);
  expect((await db.query("select helper_id from public.dispatch_candidates($1, 1000)", [d.id])).rows).toEqual([]);
  expect((await db.query("select deal_id from public.nearby_open_deals($1)", [helperId])).rows).not.toContainEqual({ deal_id: d.id });
  expect((await sqlError(persist(null, post("plumbing", true)))).message).toMatch(/invited helper/);
});

it("rejects revoked membership at application and assignment and rolls back the entire transition", async () => {
  let d = await persist(null, post());
  await db.query("update public.org_members set status = 'removed' where org_id = $1", [orgId]);
  expect((await sqlError(step(d, { type: "apply", note: "" }, worker("plumbing")))).message).toMatch(/not qualified/);
  expect(await loadDeal(db, d.id)).toEqual(d);
  await db.query("update public.org_members set status = 'active' where org_id = $1", [orgId]);
  d = await step(d, { type: "apply", note: "" }, worker("plumbing"));
  await db.query("update public.organizations set status = 'suspended' where id = $1", [orgId]);
  expect((await sqlError(step(d, { type: "choose", helperId }, customer))).message).toMatch(/not qualified/);
  expect(await loadDeal(db, d.id)).toEqual(d);
});

it("persists the company through bargaining and release without crediting the worker", async () => {
  let d = await persist(null, post());
  d = await step(d, { type: "apply", note: "Ready" }, worker("plumbing"));
  d = await step(d, { type: "counter", helperId, price: 12_000 }, customer);
  d = await step(d, { type: "accept_counter" }, worker("plumbing"));
  expect(d.payeeOrgId).toBe(orgId);
  d = await step(d, { type: "confirm_payment", providerRef: `pay-${d.id}`, amount: amountDue(d) }, { kind: "provider" });
  expect((await sqlError(db.query("update public.deals set payee_org_id = null where id = $1", [d.id]))).message).toMatch(/recipient of a paid job/);
  d = await step(d, { type: "start" }, worker("plumbing"));
  d = await step(d, { type: "record_handover" }, worker("plumbing"));
  d = await step(d, { type: "finish" }, worker("plumbing"));
  // Company keeps responsibility for the assigned job even if the member subsequently leaves.
  await db.query("update public.org_members set status = 'removed' where org_id = $1", [orgId]);
  d = await step(d, { type: "confirm" }, customer);
  const { rows } = await db.query<{ to_account: string; amount: number }>("select to_account, amount from public.ledger_entries where deal_id = $1 and kind = 'release_fee'", [d.id]);
  expect(rows.map((r) => ({ ...r, amount: Number(r.amount) }))).toEqual([{ to_account: `payable:${orgId}`, amount: 12_000 }]);
  expect((await db.query("select * from public.ledger_invariant_violations()" )).rows).toEqual([]);
});

it("registration and payout account are atomic", async () => {
  const registration = { name: "Test company", reg_number: "7654321", kind: "company", owner_id: customerId, requested_categories: ["plumbing"], doc_path: "private.pdf" };
  await sqlError(as(db, "service_role", null, (tx) => rpc(tx, "register_organization", { p_org: registration, p_payout: { bank: "Bank", account_number: "bad", holder_name: "Test company" } })));
  expect((await db.query("select id from public.organizations where reg_number = '7654321'")).rows).toEqual([]);
  const id = await as(db, "service_role", null, (tx) => rpc(tx, "register_organization", { p_org: registration, p_payout: { bank: "Bank", account_number: "12345678", holder_name: "Test company" } }));
  expect((await db.query("select org_id from public.organization_payout_accounts where org_id = $1", [id])).rows).toHaveLength(1);
});

it.each(["anon", "authenticated"] as const)("%s cannot read private org or certificate data or call server-only RPCs", async (role) => {
  for (const table of ["organizations", "organization_payout_accounts", "org_members", "helper_certificates", "category_settings"]) {
    expect((await sqlError(as(db, role, helperId, (tx) => tx.query(`select * from public.${table}`)))).message).toMatch(/permission denied/);
  }
  expect((await sqlError(as(db, role, helperId, (tx) => tx.query("select * from public.qualified_helper_ids('plumbing')")))).message).toMatch(/permission denied/);
  expect((await sqlError(as(db, role, helperId, (tx) => rpc(tx, "register_organization", { p_org: {}, p_payout: {} })))).message).toMatch(/permission denied/);
  const bucket = await db.query<{ public: boolean }>("select public from storage.buckets where id = 'kyc'");
  expect(bucket.rows).toEqual([{ public: false }]);
});

it("care: the job is assigned only to someone the customer really talked to on this task (≥ 30 s call)", async () => {
  await db.exec("update public.category_settings set live = true where category = 'childcare'");
  let d = await persist(null, post("childcare"));
  d = await step(d, { type: "apply", note: "" }, worker("childcare"));
  const choose: Command = { type: "choose", helperId };
  // no call, a missed call, or a 12-second call: the database refuses the assignment
  expect((await sqlError(step(d, choose, customer))).message).toMatch(/talk to the helper/);
  for (const text of ["call:missed:voice", "call:ended:voice:12"]) {
    await db.query("insert into public.messages (deal_id, helper_id, from_user_id, is_system, text) values ($1, $2, $3, true, $4)", [d.id, helperId, customerId, text]);
    expect((await sqlError(step(d, choose, customer))).message).toMatch(/talk to the helper/);
  }
  // a real call (answered, 45 s) in this helper's conversation: now they can be chosen
  await db.query("insert into public.messages (deal_id, helper_id, from_user_id, is_system, text) values ($1, $2, $3, true, 'call:ended:video:45')", [d.id, helperId, customerId]);
  d = await step(d, choose, customer);
  expect(d).toMatchObject({ status: "awaiting_payment", helperId });
});

it("care: a late back-out pauses the helper 7 days at once; the job is posted anew", async () => {
  await db.exec("update public.category_settings set live = true where category = 'childcare'; delete from public.helper_penalties;");
  let d = await persist(null, post("childcare"));
  d = await step(d, { type: "apply", note: "" }, worker("childcare"));
  await db.query("insert into public.messages (deal_id, helper_id, from_user_id, is_system, text) values ($1, $2, $3, true, 'call:ended:voice:60')", [d.id, helperId, customerId]);
  d = await step(d, { type: "choose", helperId }, customer);
  d = await step(d, { type: "confirm_payment", providerRef: `care-${d.id}`, amount: amountDue(d) }, { kind: "provider" });
  now += 20 * 60_000; // past the 10-minute grace
  d = await step(d, { type: "cancel" }, worker("childcare"));
  expect(d).toMatchObject({ status: "open", helperId: null, heldAmount: 0 });
  const pen = await db.query<{ pause_days: number }>("select pause_days from public.helper_penalties where deal_id = $1", [d.id]);
  expect(pen.rows).toEqual([{ pause_days: 7 }]);
  const until = await db.query<{ v: string }>("select to_jsonb(suspended_until) #>> '{}' as v from public.profiles where id = $1", [helperId]);
  expect(Date.parse(until.rows[0].v) - now).toBe(7 * 86_400_000);
});

it("first-aid claims and travel time live in the database with safe defaults", async () => {
  const cols = await db.query<{ table_name: string; column_name: string; column_default: string }>(
    "select table_name, column_name, column_default from information_schema.columns where (table_name, column_name) in (('helper_certificates', 'first_aid'), ('pricing_settings', 'travel_min_per_km')) order by table_name",
  );
  expect(cols.rows).toEqual([
    { table_name: "helper_certificates", column_name: "first_aid", column_default: "false" },
    { table_name: "pricing_settings", column_name: "travel_min_per_km", column_default: "3" },
  ]);
  const bad = await sqlError(db.query("update public.pricing_settings set travel_min_per_km = 60"));
  expect(bad.message).toMatch(/check constraint/);
});

describe("task conditions in the database", () => {
  const cond = (require: Record<string, unknown>, category: CategoryId = "shop") =>
    createErrand(
      { id: crypto.randomUUID(), title: "Bring it", description: "x", category, mode: "now", address: "Test", customerId, fee: 10_000, itemBudget: 0, details: { require } as never },
      { now, actor: customer },
    );
  const shopHelper: UserActor = { kind: "user", id: helperId, role: "helper", helperApproved: true, categories: ["shop"], badges: { driver: true, car: false, checked: true, onTimeOk: true, languages: ["en"] } };

  it("a helper without a checked licence can't apply or be chosen, even if the app is fooled", async () => {
    await db.exec("delete from public.helper_badges");
    let d = await persist(null, cond({ driver: true }));
    // the engine is told the helper has a licence, but the database knows better
    expect((await sqlError(step(d, { type: "apply", note: "" }, shopHelper))).message).toMatch(/conditions/);
    await db.query("insert into public.helper_badges (helper_id, kind, status, doc_path) values ($1, 'driver', 'approved', 'x/licence.jpg')", [helperId]);
    d = await step(d, { type: "apply", note: "" }, shopHelper);
    expect(d.offers).toHaveLength(1);
    // an expired licence no longer counts
    await db.query("update public.helper_badges set expires_on = '2020-01-01' where helper_id = $1", [helperId]);
    expect((await sqlError(step(d, { type: "choose", helperId }, customer))).message).toMatch(/conditions/);
    await db.exec("delete from public.helper_badges");
  });

  it("languages, background check: checked against the profile", async () => {
    const d = await persist(null, cond({ language: "ru", checked: true }));
    const saysRussian: UserActor = { ...shopHelper, badges: { driver: false, car: false, checked: true, onTimeOk: true, languages: ["ru"] } };
    // the app believes the helper speaks Russian; the profile says otherwise
    expect((await sqlError(step(d, { type: "apply", note: "" }, saysRussian))).message).toMatch(/conditions/);
    await db.query("update public.profiles set languages = '{ru}' where id = $1", [helperId]);
    expect((await step(d, { type: "apply", note: "" }, saysRussian)).offers).toHaveLength(1);
    expect((await sqlError(db.query("update public.profiles set languages = '{klingon}' where id = $1", [helperId]))).message).toMatch(/check constraint/);
    await db.query("update public.profiles set languages = '{}' where id = $1", [helperId]);
  });

  it("'talk first' on an everyday task needs a real call, like care work", async () => {
    let d = await persist(null, cond({ call: true }));
    d = await step(d, { type: "apply", note: "" }, shopHelper);
    expect((await sqlError(step(d, { type: "choose", helperId }, customer))).message).toMatch(/talk to the helper/);
    await db.query("insert into public.messages (deal_id, helper_id, from_user_id, is_system, text) values ($1, $2, $3, true, 'call:ended:voice:40')", [d.id, helperId, customerId]);
    d = await step(d, { type: "choose", helperId }, customer);
    expect(d.helperId).toBe(helperId);
  });

  it("location is required during a job: on at start, can't be switched off, route kept, gone at finish", async () => {
    let d = await step(await persist(null, cond({})), { type: "accept" }, shopHelper);
    const toggle = (id: string, enabled: boolean) => as(db, "service_role", null, async tx =>
      (await tx.query<{ ok: boolean }>("select public.set_job_location_sharing($1,$2,$3) as ok", [d.id, id, enabled])).rows[0].ok);
    const record = (id: string) => as(db, "service_role", null, async tx =>
      (await tx.query<{ n: number }>("select public.record_job_position($1, 47.9, 106.9) as n", [id])).rows[0].n);
    const points = async () => (await db.query<{ n: number }>("select count(*)::int as n from public.job_location_points where deal_id = $1", [d.id])).rows[0].n;
    d = await step(d, { type: "confirm_payment", providerRef: d.id, amount: amountDue(d) }, { kind: "provider" });
    expect(await toggle(helperId, true)).toBe(false); // not started yet
    expect(await record(helperId)).toBe(0);
    d = await step(d, { type: "start" }, shopHelper);
    // sharing is on without opting in; only the assigned helper's samples count
    expect(await record(customerId)).toBe(0);
    expect(await record(helperId)).toBe(1);
    expect(await toggle(helperId, false)).toBe(false);
    expect(await record(helperId)).toBe(1);
    expect(await points()).toBe(1); // at most one route point per 20 s
    expect((await sqlError(as(db, "authenticated", customerId, tx => tx.query("select * from public.job_locations")))).code).toBe("42501");
    expect((await sqlError(as(db, "authenticated", helperId, tx => tx.query("select * from public.job_location_points")))).code).toBe("42501");
    d = await step(d, { type: "record_handover" }, shopHelper);
    d = await step(d, { type: "finish" }, shopHelper);
    expect(await record(helperId)).toBe(0);
    expect(await points()).toBe(1); // the route stays for disputes…
    await db.query("update public.job_location_points set recorded_at = now() - interval '31 days' where deal_id = $1", [d.id]);
    expect((await db.query<{ n: number }>("select public.purge_job_routes() as n")).rows[0].n).toBeGreaterThanOrEqual(1);
    expect(await points()).toBe(0); // …until the retention days pass
  });

  it("commits Wire and the ledger together, retries cleanly, and queues one refund per late payment", async () => {
    const d = await step(await persist(null, cond({})), { type: "accept" }, shopHelper);
    const amount = amountDue(d);
    const intent = `pi-${d.id}`;
    const late = `late-${d.id}`;
    const result = apply(d, { type: "confirm_payment", providerRef: intent, amount }, { now, actor: { kind: "provider" } });
    const args = applyTransitionArgs(d, result, now);
    const settle = (id: string, transition: unknown, version = d.version) => as(db, "service_role", null, async tx =>
      (await tx.query<{ result: string }>("select public.settle_wire_payment($1,$2,'charge',$3,$4) as result",
        [id, amount, version, transition && JSON.stringify(transition)])).rows[0].result);
    await db.query("insert into public.provider_payments(id,provider,deal_id,purpose,amount) values ($1,'wire',$2,'first',$3)", [intent,d.id,amount]);
    expect((await sqlError(settle(intent, args, d.version - 1))).code).toBe("PT409");
    await sqlError(settle(intent, { ...args, p_ledger: [] }));
    expect((await loadDeal(db, d.id))?.version).toBe(d.version);
    expect((await db.query("select status from public.provider_payments where id=$1", [intent])).rows).toEqual([{ status: "pending" }]);
    expect(await settle(intent,args)).toBe("booked");
    expect(await settle(intent,null)).toBe("already");
    expect((await db.query("select amount::int from public.ledger_entries where provider_ref=$1", [intent])).rows).toEqual([{ amount }]);
    const matched = await loadDeal(db,d.id) as ErrandDeal;
    await db.query("insert into public.provider_payments(id,provider,deal_id,purpose,amount) values ($1,'wire',$2,'first',$3)", [late,d.id,amount]);
    expect(await settle(late,null,matched.version)).toBe("refunded");
    expect(await settle(late,null,matched.version)).toBe("already");
    const refundRows = () => db.query("select payment_id,amount::int from public.provider_refunds where deal_id=$1 order by payment_id", [d.id]);
    expect((await refundRows()).rows).toEqual([{ payment_id: late, amount }]);
    await step(matched, { type: "cancel" }, shopHelper);
    for (let i = 0; i < 2; i++) await as(db, "service_role", null, tx => tx.query("select public.queue_wire_refunds($1)", [d.id]));
    expect((await refundRows()).rows).toEqual([{ payment_id: late, amount }, { payment_id: intent, amount }]);
  });

  it("a handover code: the job can't be marked done until the code was entered", async () => {
    let d = await persist(null, cond({ handoverCode: true }));
    expect((await db.query<{ code: string }>("select code from public.handover_codes where deal_id = $1", [d.id])).rows[0]?.code).toMatch(/^\d{4}$/);
    d = await step(d, { type: "accept" }, shopHelper);
    d = await step(d, { type: "confirm_payment", providerRef: `code-${d.id}`, amount: amountDue(d) }, { kind: "provider" });
    d = await step(d, { type: "start" }, shopHelper);
    d = await step(d, { type: "record_handover" }, shopHelper);
    expect((await sqlError(step(d, { type: "finish" }, shopHelper))).message).toMatch(/handover code/);
    const check = (helper: string, attempt: string) => as(db, "service_role", null, async tx =>
      (await tx.query<{ result: string }>("select public.check_handover_code($1,$2,$3) as result", [d.id, helper, attempt])).rows[0].result);
    const { code } = (await db.query<{ code: string }>("select code from public.handover_codes where deal_id=$1", [d.id])).rows[0];
    expect(await check(customerId, code)).toBe("missing");
    for (let i = 0; i < 4; i++) expect(await check(helperId, "invalid")).toBe("wrong");
    expect(await check(helperId, "invalid")).toBe("locked");
    expect(await check(helperId, code)).toBe("locked");
    await db.query("update public.handover_codes set locked_until = now() - interval '1 second' where deal_id=$1", [d.id]);
    expect(await check(helperId, code)).toBe("ok");
    d = await step(d, { type: "finish" }, shopHelper);
    expect(d.status).toBe("check");
  });

  it("the on-time record: no record until 3 booked jobs; then 90% or better", async () => {
    const r = await db.query<{ jobs: number; on_time: number }>("select * from public.helper_on_time($1)", [helperId]);
    expect(r.rows[0]).toEqual({ jobs: 0, on_time: 0 });
    expect((await db.query<{ ok: boolean }>("select private.on_time_ok($1) as ok", [helperId])).rows[0].ok).toBe(true);
  });
});
