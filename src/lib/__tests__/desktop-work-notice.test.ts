import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  result: { data: null as { hidden: boolean } | null, error: null as { message: string } | null },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      expect(table).toBe("desktop_work_notice_preferences");
      return {
        select: (columns: string) => {
          expect(columns).toBe("hidden");
          return {
            eq: (column: string, value: string) => {
              expect(column).toBe("user_id");
              expect(value).toBe("user-1");
              return { maybeSingle: async () => mocks.result };
            },
          };
        },
      };
    },
  }),
}));

import { shouldShowDesktopWorkNotice } from "@/lib/desktop-work-notice";

beforeEach(() => {
  mocks.result = { data: null, error: null };
});

it("shows the notice by default", async () => {
  await expect(shouldShowDesktopWorkNotice("user-1")).resolves.toBe(true);
});

it("hides the notice when the user's preference says hidden", async () => {
  mocks.result = { data: { hidden: true }, error: null };
  await expect(shouldShowDesktopWorkNotice("user-1")).resolves.toBe(false);
});

it("surfaces preference lookup errors", async () => {
  mocks.result = { data: null, error: { message: "permission denied" } };
  await expect(shouldShowDesktopWorkNotice("user-1")).rejects.toThrow(
    "Could not load desktop-work notice preference: permission denied",
  );
});
