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
      order: () => query,
      limit: () => query,
      returns: () => Promise.resolve(mocks.results[table]),
      maybeSingle: () => Promise.resolve(mocks.results[table]),
    };
    return query;
  },
}) }));

import { earningsSummary } from "../withdrawals";

beforeEach(() => {
  mocks.results = {
    payable_balance: { data: 12000, error: null },
    account_balance: { data: 8000, error: null },
    withdrawals: { data: [], error: null },
    payout_accounts: { data: { verified_at: "2026-11-20T00:00:00Z" }, error: null },
  };
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
