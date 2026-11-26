import { beforeEach, expect, it, vi } from "vitest";
import type { ErrandDeal } from "../engine";

const mocks = vi.hoisted(() => ({ rows: [] as ErrandDeal[], queryError: false, runCommand: vi.fn(), loadDeal: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/deals", async (original) => ({
  ...(await original<object>()),
  runCommand: mocks.runCommand,
  loadDeal: mocks.loadDeal,
}));
vi.mock("@/lib/db/mapping", async (original) => ({ ...(await original<object>()), dealFromRow: (row: ErrandDeal) => row }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      let rows = [...mocks.rows];
      const field = (row: ErrandDeal, key: string): unknown => {
        if (key === "price_change->>status") return row.priceChange?.status;
        const names = { pay_by: "payBy", match_by: "matchBy", check_until: "checkUntil", absent_at: "absentAt" } as const;
        return row[(names[key as keyof typeof names] ?? key) as keyof ErrandDeal];
      };
      const q = {
        select: () => q,
        eq: (key: string, value: string) => {
          rows = rows.filter((r) => field(r, key) === value);
          return q;
        },
        lte: (key: string, value: string) => {
          rows = rows.filter((r) => typeof field(r, key) === "number" && Number(field(r, key)) <= Date.parse(value));
          return q;
        },
        not: (key: string) => {
          rows = rows.filter((r) => field(r, key) != null);
          return q;
        },
        order: () => q,
        limit: async (n: number) => ({
          data: mocks.queryError ? null : rows.slice(0, n),
          error: mocks.queryError ? { message: "read failed" } : null,
        }),
      };
      return q;
    },
  }),
}));
import { DbError } from "../db/deals";
import { EngineError, HOUR_MS } from "../engine";
import { T0, World } from "../engine/__tests__/helpers";
import { settleDueDeals } from "../deals/queries";

function fixture(id = "task"): ErrandDeal {
  const w = new World();
  return w.get(w.post({ id })) as ErrandDeal;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.rows = [];
  mocks.queryError = false;
  mocks.runCommand.mockImplementation(async (_db, id) => {
    const deal = mocks.rows.find((row) => row.id === id)!;
    return { deal: { ...deal, version: deal.version + 1 } };
  });
});

it("escalates an unanswered offer at its own deadline before the review window closes", async () => {
  const now = T0 + 25 * HOUR_MS;
  mocks.rows = [
    {
      ...fixture(),
      status: "check",
      checkUntil: T0 + 72 * HOUR_MS,
      priceChange: { status: "proposed", at: T0, fee: 8000, from: 10000, by: "customer", providerRef: null },
    },
  ];
  await expect(settleDueDeals(now)).resolves.toBe(1);
  expect(mocks.runCommand).toHaveBeenCalledWith(
    expect.anything(),
    "task",
    { type: "escalate_offer" },
    { kind: "system" },
    expect.anything(),
  );
  expect(mocks.runCommand.mock.calls[0][4].now()).toBe(now);
});

it("settles a task only once when both its review and offer deadlines have passed", async () => {
  mocks.rows = [
    {
      ...fixture(),
      status: "check",
      checkUntil: T0 + HOUR_MS,
      priceChange: { status: "proposed", at: T0, fee: 8000, from: 10000, by: "customer", providerRef: null },
    },
  ];
  await expect(settleDueDeals(T0 + 25 * HOUR_MS)).resolves.toBe(1);
  expect(mocks.runCommand).toHaveBeenCalledOnce();
});

it("does not mistake a failed due-task read for an empty queue", async () => {
  mocks.queryError = true;
  await expect(settleDueDeals(T0)).rejects.toBeInstanceOf(AggregateError);
  expect(mocks.runCommand).not.toHaveBeenCalled();
});

it("continues with other tasks but reports a failed settlement instead of hiding it as a race", async () => {
  mocks.rows = [fixture("one"), fixture("two")];
  mocks.runCommand.mockRejectedValueOnce(new DbError({ message: "write failed", code: "42501" }));
  await expect(settleDueDeals(T0 + HOUR_MS)).rejects.toBeInstanceOf(AggregateError);
  expect(mocks.runCommand).toHaveBeenCalledTimes(2);
  expect(mocks.loadDeal).not.toHaveBeenCalled();
});

it("reloads a genuine concurrent transition", async () => {
  const deal = fixture();
  mocks.rows = [deal];
  mocks.runCommand.mockRejectedValueOnce(new EngineError("ILLEGAL_TRANSITION", "already expired"));
  mocks.loadDeal.mockResolvedValue({ ...deal, status: "expired", version: deal.version + 1 });
  await expect(settleDueDeals(T0 + HOUR_MS)).resolves.toBe(1);
});

it("reports a rule error when the stored deal has not changed", async () => {
  const deal = fixture();
  mocks.rows = [deal];
  mocks.runCommand.mockRejectedValueOnce(new EngineError("ILLEGAL_TRANSITION", "cannot settle"));
  mocks.loadDeal.mockResolvedValue(deal);
  await expect(settleDueDeals(T0 + HOUR_MS)).rejects.toBeInstanceOf(AggregateError);
});
