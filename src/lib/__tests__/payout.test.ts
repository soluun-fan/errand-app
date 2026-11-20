import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  responses: [] as Array<{ data: unknown; error: { code?: string; message?: string } | null }>,
  selected: [] as string[],
  from: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from }) }));
vi.mock("@/lib/helper-test-mode", () => ({ isActiveTestHelper: ({ test_helper }: { test_helper?: boolean }) => test_helper === true }));
vi.mock("@/lib/safety", () => ({ adminIds: async () => [], audit: async () => {} }));
vi.mock("@/lib/push", () => ({ notify: async () => {} }));

import { setPayout } from "@/lib/payout";

beforeEach(() => {
  mocks.responses.length = 0;
  mocks.selected.length = 0;
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
    upsert: () => ({ throwOnError: async () => {} }),
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
    accountNumber: "50000024444",
    holderName: "Тест Бат",
  })).resolves.toBe("ok");
  expect(mocks.selected).toEqual(["role, helper_status, verified_name, test_helper", "role, helper_status, verified_name", "account_number"]);
});

it("does not convert unrelated profile lookup errors into a not-helper response", async () => {
  mocks.responses.push({ data: null, error: { code: "42501", message: "permission denied" } });

  await expect(setPayout("user-1", {
    bank: "Хаан банк",
    accountNumber: "50000024444",
    holderName: "Тест Бат",
  })).rejects.toThrow("Could not load helper payout eligibility: permission denied");
  expect(mocks.selected).toEqual(["role, helper_status, verified_name, test_helper"]);
});
