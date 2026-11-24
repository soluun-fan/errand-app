import { expect, it, vi } from "vitest";

const writes = vi.hoisted(() => [] as { table: string; values: Record<string, unknown> }[]);
const { notify } = vi.hoisted(() => ({ notify: vi.fn(async () => 1) }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/push", () => ({ notify }));
vi.mock("@/lib/safety", () => ({ adminIds: async () => ["ops-1"] }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: (table: string) => {
    const data = table === "helper_applications" ? { user_id: "helper", legal_name: "Тест Бат", categories: ["deliver"] }
      : table === "profiles" ? { role: "customer" }
        : { bank: "Хаан банк", account_number: "50000024444", holder_name: "Тест Бат" };
    const q = {
      select: () => q,
      eq: () => q,
      maybeSingle: async () => ({ data, error: null }),
      single: async () => ({ data, error: null }),
      update: (values: Record<string, unknown>) => { writes.push({ table, values }); return q; },
      throwOnError: async () => ({}),
    };
    return q;
  },
}) }));

import { decide } from "../kyc";

it("approving identity does not approve ownership of a user-entered bank account", async () => {
  await expect(decide("application", "ops", "approve", null, ["deliver"])).resolves.toBe(true);
  expect(writes.find(w => w.table === "profiles")?.values).toMatchObject({ verified_name: "Тест Бат", helper_status: "approved" });
  expect(writes.filter(w => w.table === "payout_accounts")).toEqual([]);
  // …and Ops is told a bank ownership check is waiting (code review 2026-11-23)
  expect(notify).toHaveBeenCalledWith(["ops-1"], expect.objectContaining({ title: "push.payoutCheckTitle", url: "/ops/withdrawals" }));
});
