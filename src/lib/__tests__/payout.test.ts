import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  responses: [] as Array<{ data: unknown; error: { code?: string; message?: string } | null }>,
  selected: [] as string[],
  from: vi.fn(),
  upserts: [] as Record<string, unknown>[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from }) }));
vi.mock("@/lib/helper-test-mode", () => ({ isActiveTestHelper: ({ test_helper }: { test_helper?: boolean }) => test_helper === true }));
vi.mock("@/lib/safety", () => ({ adminIds: async () => [], audit: async () => {} }));
vi.mock("@/lib/push", () => ({ notify: async () => {} }));

import { hasPayout, setPayout } from "@/lib/payout";

beforeEach(() => {
  mocks.responses.length = 0;
  mocks.selected.length = 0;
  mocks.upserts.length = 0;
  mocks.from.mockImplementation((table: string) => ({
    select: (columns: string) => {
      mocks.selected.push(columns);
      return {
        eq: () => ({
          maybeSingle: async () =>
            table === "profiles" ? mocks.responses.shift() : { data: null, error: null },
        }),
      };
    },
    upsert: (data: Record<string, unknown>) => { mocks.upserts.push(data); return { throwOnError: async () => {} }; },
    update: () => ({ eq: () => ({ throwOnError: async () => {} }) }),
  }));
});

it("allows an approved helper to add a payout account when only test_helper is missing", async () => {
  mocks.responses.push(
    { data: null, error: { code: "42703", message: "column profiles.test_helper does not exist" } },
    { data: { role: "helper", helper_status: "approved", verified_name: "Тест Бат" }, error: null },
  );

  await expect(setPayout("user-1", {
    bank: "Хаан банк",
    accountNumber: "MN500005005012345678",
    holderName: "Тест Бат",
  })).resolves.toBe("ok");
  expect(mocks.selected).toEqual(["role, helper_status, verified_name, test_helper", "role, helper_status, verified_name", "account_number"]);
  expect(mocks.upserts).toHaveLength(1);
  expect(mocks.upserts[0].verified_at).toBeNull();
});

it("does not tell a helper their bank account is missing when the account read failed", async () => {
  mocks.from.mockReturnValue({ select: () => ({ eq: async () => ({ count: null, error: { message: "bank lookup unavailable" } }) }) });
  await expect(hasPayout("user-1")).rejects.toThrow("bank lookup unavailable");
});

it("never verifies a bank account just because the typed holder matches an ID-checked name", async () => {
  mocks.responses.push({ data: { role: "helper", helper_status: "approved", verified_name: "Тест Бат", test_helper: false }, error: null });
  await expect(setPayout("user-1", { bank: "Хаан банк", accountNumber: "MN500005005012345678", holderName: "Тест Бат" })).resolves.toBe("ok");
  expect(mocks.upserts[0]).toMatchObject({ verified_at: null, account_number: "MN500005005012345678" });
});

it("rejects an IBAN with a valid shape but a bad checksum before saving it", async () => {
  mocks.responses.push({ data: { role: "helper", helper_status: "approved", verified_name: "Тест Бат", test_helper: false }, error: null });
  await expect(setPayout("user-1", { bank: "Хаан банк", accountNumber: "MN360005001109042377", holderName: "Тест Бат" })).resolves.toBe("account");
  expect(mocks.upserts).toEqual([]);
});

it("does not convert unrelated profile lookup errors into a not-helper response", async () => {
  mocks.responses.push({ data: null, error: { code: "42501", message: "permission denied" } });

  await expect(setPayout("user-1", {
    bank: "Хаан банк",
    accountNumber: "MN500005005012345678",
    holderName: "Тест Бат",
  })).rejects.toThrow("Could not load helper payout eligibility: permission denied");
  expect(mocks.selected).toEqual(["role, helper_status, verified_name, test_helper"]);
});
