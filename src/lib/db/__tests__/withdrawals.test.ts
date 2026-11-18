import { type PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { insertDealArgs } from "@/lib/db/mapping";
import { createErrand } from "@/lib/engine";
import { as, createTestDb, rpc, sqlError } from "./pg";

/** Managed service (migration 20261118060000): withdraw-only earnings and the day-job limit. */
const helperId = "00000000-0000-4000-8000-000000000041";
const customerId = "00000000-0000-4000-8000-000000000042";
const opsId = "00000000-0000-4000-8000-000000000043";
let db: PGlite;

const svc = (sql: string, params: unknown[] = []) => as(db, "service_role", null, (tx) => tx.query(sql, params));
const balance = async (account: string) => Number(((await svc("select public.account_balance($1) as v", [account])).rows[0] as { v: string }).v);
/** Earnings released to the helper (what the engine books when a job is confirmed). */
const earn = async (amount: number) => {
  await db.query("set session_replication_role = replica"); // a bare ledger line without a deal, for the test
  await db.query("insert into public.ledger_entries (kind, amount, from_account, to_account) values ('release_fee', $1, 'platform', $2)", [amount, `payable:${helperId}`]);
  await db.query("set session_replication_role = origin");
};
const request = (auto = false) => svc("select * from public.request_withdrawal($1, $2)", [helperId, auto]);

beforeAll(async () => {
  db = await createTestDb();
  for (const id of [helperId, customerId, opsId]) await db.query("insert into auth.users (id, phone) values ($1, $2)", [id, `97688300${id.slice(-2)}`]);
  await db.query("update public.profiles set role = 'helper', helper_status = 'approved', categories = '{dayjob,shop}' where id = $1", [helperId]);
  await db.query("update public.profiles set role = 'admin' where id = $1", [opsId]);
});
afterAll(async () => {
  await db?.close();
});

describe("withdrawals", () => {
  it("are server-only, and the new settings have the spec's defaults", async () => {
    const e = await sqlError(as(db, "authenticated", helperId, (tx) => tx.query("select * from public.withdrawals")));
    expect(e.message).toMatch(/permission denied/);
    const r = (await db.query("select pay_mode, check_hours, payment_window_booked_minutes, withdraw_min, withdrawals_per_day, auto_payout_days, dayjob_pair_month_cap from public.platform_rules")).rows[0];
    expect(r).toEqual({ pay_mode: "held", check_hours: 3, payment_window_booked_minutes: 30, withdraw_min: 3000, withdrawals_per_day: 2, auto_payout_days: 30, dayjob_pair_month_cap: 8 });
    const p = (await db.query("select suggest_bps, max_job_total from public.pricing_settings")).rows[0];
    expect(p).toEqual({ suggest_bps: 12500, max_job_total: 200000 });
  });

  it("need a checked bank account of the helper's own", async () => {
    await earn(10_000);
    expect((await sqlError(request())).message).toMatch(/bank account not checked/);
    await svc("insert into public.payout_accounts (user_id, bank, account_number, holder_name) values ($1, 'Хаан банк', '5012345678', 'Test Helper')", [helperId]);
    expect((await sqlError(request())).message).toMatch(/bank account not checked/); // added, not yet checked
    await svc("update public.payout_accounts set verified_at = now() where user_id = $1", [helperId]);
  });

  it("take the whole available amount; the ledger moves it to 'on its way', then to the bank", async () => {
    const w = (await request()).rows[0] as { id: string; amount: string; reference: string; status: string; account_number: string };
    expect({ ...w, amount: Number(w.amount) }).toMatchObject({ amount: 10_000, status: "requested", account_number: "5012345678" });
    expect(w.reference).toMatch(/^PAYOUT-[0-9A-F]{8}$/);
    expect(await balance(`payable:${helperId}`)).toBe(0);
    expect(await balance(`payout:${helperId}`)).toBe(10_000);
    // nothing left to ask for
    expect((await sqlError(request())).message).toMatch(/below the minimum/);
    await svc("select public.decide_withdrawal($1, $2, true, null)", [w.id, opsId]);
    expect(await balance(`payout:${helperId}`)).toBe(0);
    expect(await balance(`ext:${helperId}`)).toBe(10_000);
    // handled once only
    expect((await sqlError(svc("select public.decide_withdrawal($1, $2, true, null)", [w.id, opsId]))).message).toMatch(/already handled/);
  });

  it("a failed transfer goes back to what we owe; at most N a day; a minimum unless automatic", async () => {
    await earn(5_000);
    const w = (await request()).rows[0] as { id: string };
    await svc("select public.decide_withdrawal($1, $2, false, 'wrong account')", [w.id, opsId]);
    expect(await balance(`payable:${helperId}`)).toBe(5_000);
    expect((await sqlError(request())).message).toMatch(/too many withdrawals today/); // 2 already today
    await svc("update public.platform_rules set withdrawals_per_day = 5");
    await earn(1); // 5,001 now
    await svc("update public.platform_rules set withdraw_min = 10000");
    expect((await sqlError(request())).message).toMatch(/below the minimum/);
    const auto = (await request(true)).rows[0] as { amount: string; auto: boolean };
    expect({ ...auto, amount: Number(auto.amount) }).toMatchObject({ amount: 5001, auto: true }); // the 30-day payout ignores the minimum
    await svc("update public.platform_rules set withdraw_min = 3000, withdrawals_per_day = 2");
  });

  it("the ledger refuses unknown accounts; withdrawals can't be edited around the functions' checks", async () => {
    const bad = await sqlError(svc("insert into public.ledger_entries (kind, amount, from_account, to_account) values ('withdrawal', 1, 'payable:x', 'wallet:y')"));
    expect(bad.message).toMatch(/valid_accounts|check constraint/);
    const half = await sqlError(svc("update public.withdrawals set status = 'sent' where status = 'requested'"));
    expect(half.message).toMatch(/withdrawals_decided/);
  });
});

describe("day jobs stay one-off help", () => {
  it("the same poster can't book the same helper for more than the monthly cap", async () => {
    await svc("update public.platform_rules set dayjob_pair_month_cap = 2");
    const assign = async () => {
      const t = createErrand(
        { id: crypto.randomUUID(), title: "Help at the shop", description: "x", category: "dayjob", mode: "schedule", scheduledAt: Date.now() + 86_400_000, address: "Test", customerId, fee: 40_000, itemBudget: 0, details: { minutes: 240 } },
        { now: Date.now(), actor: { kind: "user", id: customerId, role: "customer" } },
      );
      await as(db, "service_role", null, (tx) => rpc(tx, "insert_deal", insertDealArgs(t)));
      return svc("update public.deals set helper_id = $2, assigned_at = now(), status = 'awaiting_payment' where id = $1", [t.deal.id, helperId]);
    };
    await assign();
    await assign();
    expect((await sqlError(assign())).message).toMatch(/day job limit with this helper reached/);
    await svc("update public.platform_rules set dayjob_pair_month_cap = 8");
  });
});
