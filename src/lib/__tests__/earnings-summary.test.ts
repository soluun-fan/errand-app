import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ results: {} as Record<string, { data: unknown; error: { message: string } | null }> }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/push", () => ({ notify: vi.fn() }));
vi.mock("@/lib/safety", () => ({ adminIds: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/rules", () => ({ getRules: async () => ({ withdrawMin: 3000, withdrawalsPerDay: 2, autoPayoutDays: 7 }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: (name: string) => Promise.resolve(mocks.results[name]),
  from: (table: string) => {
    const query = {
      select: () => query,
      eq: () => query,
      in: () => query,
      order: () => query,
      limit: () => query,
      returns: () => Promise.resolve(mocks.results[table]),
      maybeSingle: () => Promise.resolve(mocks.results[table]),
    };
    return query;
  },
}) }));

import { earningsSummary, withdrawalQueue } from "../withdrawals";

beforeEach(() => {
  mocks.results = {
    payable_balance: { data: 12000, error: null },
    account_balance: { data: 8000, error: null },
    withdrawals: { data: [], error: null },
    payout_accounts: { data: { verified_at: "2026-11-20T00:00:00Z" }, error: null },
  };
});

it("does not present a failed payout queue read as no withdrawals waiting", async () => {
  mocks.results.withdrawals = { data: null, error: { message: "queue unavailable" } };
  await expect(withdrawalQueue()).rejects.toThrow("queue unavailable");
});

it("does not hide failed recipient lookups in the payout queue", async () => {
  mocks.results.withdrawals.data = [{ helper_id: "helper-a" }];
  mocks.results.profiles = { data: null, error: { message: "recipients unavailable" } };
  await expect(withdrawalQueue()).rejects.toThrow("recipients unavailable");
});

it("keeps queued money separate and uses the configured automatic payout interval", async () => {
  await expect(earningsSummary("helper-1")).resolves.toMatchObject({
    available: 12000, onTheWay: 8000, autoPayoutDays: 7, accountChecked: true,
  });
});

it.each(["payable_balance", "account_balance", "withdrawals", "payout_accounts"])("does not hide a failed %s read as an empty amount or missing account", async (key) => {
  mocks.results[key] = { data: null, error: { message: "database unavailable" } };
  await expect(earningsSummary("helper-1")).rejects.toThrow("database unavailable");
});

it("shares a recorded bank reference only for sent payments, without exposing other Ops notes", async () => {
  const row = { amount: 10000, reference: "PAYOUT-TEST", auto: false, requested_at: "2026-11-22T00:00:00Z", decided_at: "2026-11-22T00:05:00Z", bank: "Хаан банк", account_number: "50000024444" };
  mocks.results.withdrawals.data = [
    { ...row, id: "sent", status: "sent", note: "Bank transaction: BANK-123" },
    { ...row, id: "pending", status: "requested", note: "Bank transaction: BANK-456" },
    { ...row, id: "failed", status: "failed", note: "Internal review note" },
  ];
  const summary = await earningsSummary("helper-1");
  expect(summary.recent.map(w => w.bankReference)).toEqual(["BANK-123", null, null]);
  expect(summary.recent[0].account).toBe("•••• 4444");
  expect(summary.recent[2]).not.toHaveProperty("note");
});
