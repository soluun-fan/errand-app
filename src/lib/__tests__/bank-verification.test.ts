import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  results: [] as { data: unknown; error: { message: string } | null }[],
  writes: [] as { values: Record<string, unknown>; filters: [string, unknown][] }[],
  audit: vi.fn(), rpc: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/push", () => ({ notify: async () => {} }));
vi.mock("@/lib/safety", () => ({ adminIds: async () => [], audit: mocks.audit }));
vi.mock("@/lib/rules", () => ({ getRules: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: mocks.rpc,
  from: () => {
    const filters: [string, unknown][] = [];
    const q = {
      select: () => q,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return q; },
      is: (key: string, value: unknown) => { filters.push([key, value]); return q; },
      maybeSingle: () => q,
      update: (values: Record<string, unknown>) => { mocks.writes.push({ values, filters }); return q; },
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(mocks.results.shift()).then(resolve, reject),
    };
    return q;
  },
}) }));

import { decideWithdrawal, markAccountChecked } from "../withdrawals";

const updatedAt = "2026-11-22T00:00:00Z";
const account = { bank: "Хаан банк", account_number: "50000024444", holder_name: "Тест Бат", updated_at: updatedAt, verified_at: null };
const evidence = { updatedAt, bankHolderName: "Тест Бат", reference: "BANK-LOOKUP-123" };

beforeEach(() => {
  mocks.results.length = 0;
  mocks.writes.length = 0;
  mocks.audit.mockReset();
  mocks.audit.mockResolvedValue(undefined);
  mocks.rpc.mockReset();
});

function reads(a: unknown = account, p: unknown = { verified_name: "Тест Бат" }) {
  mocks.results.push({ data: a, error: null }, { data: p, error: null });
}

it("requires independent ownership evidence before considering approval", async () => {
  await expect(markAccountChecked("helper", "ops", { ...evidence, reference: "" })).resolves.toBe("evidence");
  expect(mocks.writes).toEqual([]);
  expect(mocks.audit).not.toHaveBeenCalled();
});

it("requires an ID-verified identity and the bank-returned holder to match", async () => {
  reads(account, { verified_name: null });
  await expect(markAccountChecked("helper", "ops", evidence)).resolves.toBe("identity");
  reads();
  await expect(markAccountChecked("helper", "ops", { ...evidence, bankHolderName: "Өөр Хүн" })).resolves.toBe("holder");
  expect(mocks.writes).toEqual([]);
});

it("refuses to approve an account changed since the operator opened the page", async () => {
  reads({ ...account, updated_at: "2026-11-22T00:01:00Z" });
  await expect(markAccountChecked("helper", "ops", evidence)).resolves.toBe("changed");
  expect(mocks.writes).toEqual([]);
});

it("records evidence and approves only the exact reviewed account snapshot", async () => {
  reads();
  mocks.results.push({ data: [{ user_id: "helper" }], error: null });
  await expect(markAccountChecked("helper", "ops", evidence)).resolves.toBe("ok");
  expect(mocks.audit).toHaveBeenCalledWith("ops", "payout.bank_check_recorded", "helper", {
    method: "manual_bank", reference: evidence.reference, bank: account.bank, last4: "4444", accountUpdatedAt: updatedAt,
  });
  expect(mocks.writes[0].filters).toEqual([
    ["user_id", "helper"], ["updated_at", updatedAt], ["bank", account.bank],
    ["account_number", account.account_number], ["holder_name", account.holder_name], ["verified_at", null],
  ]);
});

it("does not approve when the evidence cannot be recorded", async () => {
  reads();
  mocks.audit.mockRejectedValueOnce(new Error("audit unavailable"));
  await expect(markAccountChecked("helper", "ops", evidence)).rejects.toThrow("audit unavailable");
  expect(mocks.writes).toEqual([]);
});

it("does not report approval if an account changes during the bank review save", async () => {
  reads();
  mocks.results.push({ data: [], error: null });
  await expect(markAccountChecked("helper", "ops", evidence)).resolves.toBe("changed");
});

it("does not record a transfer as sent without a bank transaction reference", async () => {
  await expect(decideWithdrawal("withdrawal", "ops", true, null)).resolves.toBe(false);
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it("stores the manual bank transfer reference with the atomic ledger decision", async () => {
  mocks.rpc.mockReturnValue({ single: async () => ({ data: { helper_id: "helper", amount: 10000, reference: "PAYOUT-TEST", id: "withdrawal" }, error: null }) });
  await expect(decideWithdrawal("withdrawal", "ops", true, null, "BANK-123")).resolves.toBe(true);
  expect(mocks.rpc).toHaveBeenCalledWith("decide_withdrawal", {
    p_id: "withdrawal", p_ops: "ops", p_sent: true, p_note: "Bank transaction: BANK-123",
  });
});
