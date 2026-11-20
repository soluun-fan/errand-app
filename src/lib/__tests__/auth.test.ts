import { beforeEach, expect, it, vi } from "vitest";

const { responses, selected, getClaims } = vi.hoisted(() => ({
  responses: [] as Array<{ data: unknown; error: { code?: string; message?: string } | null }>,
  selected: [] as string[],
  getClaims: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: <T extends (...args: never[]) => unknown>(fn: T) => fn }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getClaims } }) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: (columns: string) => {
        selected.push(columns);
        return {
          eq: () => ({
            single: async () => responses.shift(),
          }),
        };
      },
    }),
  }),
}));

import { getViewer } from "@/lib/auth";

beforeEach(() => {
  vi.resetAllMocks();
  responses.length = 0;
  selected.length = 0;
  getClaims.mockResolvedValue({ data: { claims: { sub: "user-1" } } });
});

it("loads existing users on the pre-minimal-profile schema", async () => {
  responses.push(
    { data: null, error: { code: "42703", message: "column profiles.age_confirmed_at does not exist" } },
    {
      data: {
        id: "user-1",
        name: "Tester",
        phone: "+97688000001",
        role: "customer",
        kyc_level: 1,
        helper_status: null,
        verified_name: null,
        categories: [],
        area: null,
        suspended_until: null,
        birth_date: "1990-01-01",
        terms_version: "2026-11-18",
        privacy_version: "2026-11-18",
        helper_terms_version: null,
        deleted_at: null,
      },
      error: null,
    },
  );

  const viewer = await getViewer();

  expect(viewer?.profile.age_confirmed_at).toBe("legacy-confirmed");
  expect(viewer?.profile.test_helper).toBe(false);
  expect(selected).toHaveLength(2);
  expect(selected[1]).toContain("birth_date");
});

it("reads age confirmation when only the test-helper column is missing", async () => {
  responses.push(
    { data: null, error: { code: "42703", message: "column profiles.test_helper does not exist" } },
    {
      data: {
        id: "user-1",
        name: "Tester",
        phone: "+97688000001",
        role: "customer",
        kyc_level: 1,
        helper_status: null,
        verified_name: null,
        categories: [],
        area: null,
        suspended_until: null,
        age_confirmed_at: "2026-11-19T00:00:00.000Z",
        terms_version: "2026-11-18",
        privacy_version: "2026-11-18",
        helper_terms_version: null,
        deleted_at: null,
      },
      error: null,
    },
  );

  const viewer = await getViewer();

  expect(viewer?.profile.age_confirmed_at).toBe("2026-11-19T00:00:00.000Z");
  expect(viewer?.profile.test_helper).toBe(false);
  expect(selected).toHaveLength(2);
  expect(selected[1]).toContain("age_confirmed_at");
  expect(selected[1]).not.toContain("test_helper");
});

it("does not hide unrelated profile lookup errors behind the compatibility fallback", async () => {
  responses.push({ data: null, error: { code: "42501", message: "permission denied" } });

  expect(await getViewer()).toBeNull();
  expect(selected).toHaveLength(1);
});
