import { type PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { insertDealArgs } from "@/lib/db/mapping";
import { createErrand } from "@/lib/engine";
import { as, createTestDb, rpc, sqlError } from "./pg";

/** A worker must have a bank account before working (migration 20261118050000). */
const customerId = "00000000-0000-4000-8000-000000000031";
const helperId = "00000000-0000-4000-8000-000000000032";
let db: PGlite;
let dealId = "";

const svc = (sql: string, params: unknown[] = []) => as(db, "service_role", null, (tx) => tx.query(sql, params));

beforeAll(async () => {
  db = await createTestDb();
  for (const id of [customerId, helperId]) await db.query("insert into auth.users (id, phone) values ($1, $2)", [id, `97688200${id.slice(-2)}`]);
  await db.query("update public.profiles set role = 'helper', helper_status = 'approved', categories = '{shop}' where id = $1", [helperId]);
  await db.query("insert into public.helper_presence (user_id, online, lat, lng, radius_km) values ($1, true, 47.918, 106.917, 5)", [helperId]);
  const t = createErrand(
    { id: crypto.randomUUID(), title: "Buy bread", description: "x", category: "shop", mode: "now", address: "Test", customerId, fee: 10_000, itemBudget: 0, location: { lat: 47.92, lng: 106.92 } },
    { now: Date.now(), actor: { kind: "user", id: customerId, role: "customer" } },
  );
  await as(db, "service_role", null, (tx) => rpc(tx, "insert_deal", insertDealArgs(t)));
  dealId = t.deal.id;
});
afterAll(async () => {
  await db?.close();
});

describe("no bank account, no work", () => {
  it("without one: not notified, nothing in the nearby feed, can't apply", async () => {
    const cands = await svc("select helper_id from public.dispatch_candidates($1, 1000)", [dealId]);
    expect(cands.rows).toEqual([]);
    const feed = await svc("select deal_id from public.nearby_open_deals($1)", [helperId]);
    expect(feed.rows).toEqual([]);
    const e = await sqlError(svc("insert into public.offers (deal_id, helper_id) values ($1, $2)", [dealId, helperId]));
    expect(e.message).toMatch(/add your bank account first/);
  });

  it("with one: all three work", async () => {
    await svc("insert into public.payout_accounts (user_id, bank, account_number, holder_name) values ($1, 'Хаан банк', '5012345678', 'Test Helper')", [helperId]);
    const cands = await svc("select helper_id from public.dispatch_candidates($1, 1000)", [dealId]);
    expect(cands.rows).toEqual([{ helper_id: helperId }]);
    const feed = await svc("select deal_id from public.nearby_open_deals($1)", [helperId]);
    expect(feed.rows).toEqual([{ deal_id: dealId }]);
    await svc("insert into public.offers (deal_id, helper_id) values ($1, $2)", [dealId, helperId]);
  });
});
