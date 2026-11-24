import { beforeEach, expect, it, vi } from "vitest";

type Row = { id: string; type: string; customer_id: string; helper_id?: string; status: string; created_at: string; heldAmount: number; offers: { count: number }[] };
const state = vi.hoisted(() => ({ rows: [] as Row[], failActive: false }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/deals", () => ({ loadDeal: vi.fn(), runCommand: vi.fn() }));
vi.mock("@/lib/db/mapping", () => ({ dealFromRow: (row: Row) => row }));
vi.mock("@/lib/engine", async (original) => ({ ...await original<object>(), dueCommand: () => null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => {
  let rows = [...state.rows];
  let active = false;
  const q = {
    select: () => q,
    eq: (key: keyof Row, value: string) => { rows = rows.filter((r) => r[key] === value); return q; },
    in: (key: keyof Row, values: string[]) => { active = values.includes("in_progress"); rows = rows.filter((r) => values.includes(String(r[key]))); return q; },
    order: () => q,
    range: (from: number, to: number) => { rows = rows.slice(from, to + 1); return q; },
    limit: (n: number) => { rows = rows.slice(0, n); return q; },
    returns: async () => ({ data: rows, error: active && state.failActive ? { message: "read failed" } : null }),
  };
  return q;
} }) }));

import { listMyJobs, listMyTasks } from "../deals/queries";

const row = (id: string, status: string, createdAt: string, owner = "customer-a"): Row => ({
  id, type: "errand", customer_id: owner, status, created_at: createdAt, heldAmount: status === "in_progress" ? 10000 : 0, offers: [{ count: 2 }],
});

beforeEach(() => { state.rows = []; state.failActive = false; });

it("keeps an older active task and its held amount behind more than 50 completed tasks", async () => {
  state.rows = [
    ...Array.from({ length: 60 }, (_, i) => row(`closed-${i}`, "released", "2026-11-24T00:00:00Z")),
    row("older-active", "in_progress", "2026-11-01T00:00:00Z"),
    row("other-customer", "in_progress", "2026-11-01T00:00:00Z", "customer-b"),
  ];
  const tasks = await listMyTasks("customer-a");
  expect(tasks).toHaveLength(51);
  expect(tasks.find((x) => x.deal.id === "older-active")).toMatchObject({ deal: { heldAmount: 10000 }, offerCount: 2 });
  expect(tasks.some((x) => x.deal.id === "other-customer")).toBe(false);
  expect(tasks.reduce((total, x) => total + x.deal.heldAmount, 0)).toBe(10000);
});

it("reads beyond a page of unresolved tasks and excludes history for activeOnly", async () => {
  state.rows = [row("past", "released", "2026-11-24T00:00:00Z"), ...Array.from({ length: 105 }, (_, i) => row(`active-${i}`, "disputed", "2026-11-01T00:00:00Z"))];
  const tasks = await listMyTasks("customer-a", { activeOnly: true });
  expect(tasks).toHaveLength(105);
  expect(new Set(tasks.map((x) => x.deal.id)).size).toBe(105);
  expect(tasks.every((x) => x.deal.status === "disputed")).toBe(true);
});

it("does not hide a failed active-task read behind an apparently complete history", async () => {
  state.failActive = true;
  await expect(listMyTasks("customer-a")).rejects.toThrow("read failed");
});

it("also keeps older unfinished worker jobs visible without including another worker's jobs", async () => {
  state.rows = [
    ...Array.from({ length: 60 }, (_, i) => ({ ...row(`closed-${i}`, "released", "2026-11-24T00:00:00Z"), helper_id: "worker-a" })),
    { ...row("older-review", "check", "2026-11-01T00:00:00Z"), helper_id: "worker-a" },
    { ...row("other-worker", "in_progress", "2026-11-01T00:00:00Z"), helper_id: "worker-b" },
  ];
  const jobs = await listMyJobs("worker-a");
  expect(jobs).toHaveLength(51);
  expect(jobs.some((x) => x.id === "older-review")).toBe(true);
  expect(jobs.some((x) => x.id === "other-worker")).toBe(false);
});
