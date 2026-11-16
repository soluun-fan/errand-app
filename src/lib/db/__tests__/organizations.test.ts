import { type PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyTransitionArgs, insertDealArgs } from "@/lib/db/mapping";
import { CATEGORIES, amountDue, apply, createErrand, type CategoryId, type Command, type ErrandDeal, type Transition, type UserActor } from "@/lib/engine";
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
function post(category: CategoryId = "plumbing", invite = false) {
  return createErrand({ id: crypto.randomUUID(), title: "Fix tap", description: "Leaking", category, mode: "now", address: "Test", customerId, fee: 10_000, itemBudget: 0, invite: invite ? { helperId, openAfter: true } : null }, { now, actor: customer });
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

it("individual certificates work only for trades and expire at the UB calendar-day boundary", async () => {
  await db.query("insert into public.helper_certificates(helper_id, category, issuer, doc_path, status, expires_on) values ($1, 'electrical', 'Trade body', 'private.pdf', 'approved', '2026-11-17')", [helperId]);
  expect(await allowed("electrical", null, "2026-11-17T15:59:59Z")).toBe(true);
  expect(await allowed("electrical", null, "2026-11-17T16:00:00Z")).toBe(false);
  expect((await sqlError(db.query("insert into public.helper_certificates(helper_id, category, issuer, doc_path) values ($1, 'childcare', 'Agency', 'private.pdf')", [helperId]))).message).toMatch(/pro kinds/);
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
