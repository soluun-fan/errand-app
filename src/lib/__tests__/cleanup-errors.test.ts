import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  data: {} as Record<string, unknown>,
  counts: {} as Record<string, number>,
  errors: {} as Record<string, string>,
  writes: [] as { table: string; operation: string; values?: unknown; ids?: unknown }[],
  remove: vi.fn(),
  ban: vi.fn(),
  audit: vi.fn(),
  rules: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/safety", () => ({ audit: mocks.audit, adminIds: async () => [] }));
vi.mock("@/lib/push", () => ({ notify: vi.fn() }));
vi.mock("@/lib/work-photos", () => ({ WORK_BUCKET: "work" }));
vi.mock("@/lib/rules", () => ({ getRules: mocks.rules }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      let operation = "select";
      let key = table;
      let write: (typeof mocks.writes)[number] | undefined;
      const result = () => ({
        data: mocks.data[key] ?? [],
        count: mocks.counts[key] ?? 0,
        error: mocks.errors[`${table}:${operation}`] ? { message: mocks.errors[`${table}:${operation}`] } : null,
      });
      const q = {
        select: (columns: string) => {
          if (columns.includes("direct_payments!inner")) key = "unpaid";
          return q;
        },
        eq: () => q,
        is: () => q,
        not: () => q,
        or: () => q,
        lt: () => q,
        limit: () => q,
        returns: () => q,
        order: () => q,
        in: (column: string, values: unknown) => {
          if (write && column === "id") write.ids = values;
          return q;
        },
        update: (values: unknown) => {
          operation = "update";
          write = { table, operation, values };
          mocks.writes.push(write);
          return q;
        },
        delete: () => {
          operation = "delete";
          write = { table, operation };
          mocks.writes.push(write);
          return q;
        },
        throwOnError: async () => {
          const out = result();
          if (out.error) throw new Error(out.error.message);
          return out;
        },
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
      };
      return q;
    },
    rpc: (name: string) => ({
      throwOnError: async () => {
        if (mocks.errors[name]) throw new Error(mocks.errors[name]);
        return { data: mocks.data[name] ?? 0 };
      },
    }),
    storage: { from: () => ({ remove: mocks.remove }) },
    auth: { admin: { updateUserById: mocks.ban } },
  }),
}));
import { closeAccount, closeBlocks } from "../legal";
import { purgeKycFiles } from "../kyc";
import { purgeExpiredChats } from "../chat";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.data = {};
  mocks.counts = {};
  mocks.errors = {};
  mocks.writes = [];
  mocks.remove.mockResolvedValue({ error: null });
  mocks.ban.mockResolvedValue({ error: null });
  mocks.rules.mockResolvedValue({ chatRetentionDays: 90 });
});

it.each(["deals:select", "payable_balance", "account_balance"])("cannot approve account closure when %s fails", async (key) => {
  mocks.errors[key] = "database unavailable";
  await expect(closeBlocks("user", "customer")).rejects.toThrow("database unavailable");
});
it("blocks closure for an unresolved payment report belonging to this account", async () => {
  mocks.counts.unpaid = 1;
  await expect(closeBlocks("user", "customer")).resolves.toEqual(["unpaid"]);
});
it("preserves public photo references if storage removal fails", async () => {
  mocks.data.work_photos = [{ id: "photo", file_path: "user/photo.jpg" }];
  mocks.remove.mockResolvedValue({ error: { message: "storage unavailable" } });
  await expect(closeAccount("user")).rejects.toThrow("storage unavailable");
  expect(mocks.writes).toEqual([]);
  expect(mocks.audit).not.toHaveBeenCalled();
});
it("does not close the profile or report success when personal-data cleanup fails", async () => {
  mocks.errors["saved_addresses:delete"] = "delete failed";
  await expect(closeAccount("user")).rejects.toThrow("delete failed");
  expect(mocks.writes.some((w) => w.table === "profiles")).toBe(false);
  expect(mocks.audit).not.toHaveBeenCalled();
});
it("does not report a successful sign-in ban when Auth returns an error", async () => {
  mocks.ban.mockResolvedValue({ error: { message: "Auth unavailable" } });
  await expect(closeAccount("user")).rejects.toThrow("Auth unavailable");
  expect(mocks.audit).not.toHaveBeenCalled();
});
it("keeps identity document references and their retry eligibility when storage fails", async () => {
  mocks.data.helper_applications = [
    { id: "application", id_front_path: "user/front.jpg", id_back_path: null, selfie_path: null, record_path: null },
  ];
  mocks.remove.mockResolvedValue({ error: { message: "storage unavailable" } });
  await expect(purgeKycFiles()).rejects.toMatchObject({ message: "storage unavailable" });
  expect(mocks.writes).toEqual([]);
});
it("does not count an identity purge whose database update failed", async () => {
  mocks.data.helper_applications = [{ id: "application", id_front_path: "user/front.jpg" }];
  mocks.errors["helper_applications:update"] = "update failed";
  await expect(purgeKycFiles()).rejects.toThrow("update failed");
});
it("preserves chat rows until their media has been removed", async () => {
  mocks.data.messages = [{ id: "one", image_path: "task/image.jpg", audio_path: null }];
  mocks.remove.mockResolvedValue({ error: { message: "storage unavailable" } });
  await expect(purgeExpiredChats()).rejects.toMatchObject({ message: "storage unavailable" });
  expect(mocks.writes).toEqual([]);
});
it("deletes only the selected chat rows after their files are removed", async () => {
  mocks.data.messages = [
    { id: "one", image_path: "task/image.jpg", audio_path: null },
    { id: "two", image_path: null, audio_path: "task/voice.webm" },
  ];
  await expect(purgeExpiredChats()).resolves.toBe(2);
  expect(mocks.remove).toHaveBeenCalledWith(["task/image.jpg", "task/voice.webm"]);
  expect(mocks.writes).toEqual([{ table: "messages", operation: "delete", ids: ["one", "two"] }]);
});
it("does not silently use a different retention policy when live settings fail", async () => {
  mocks.rules.mockRejectedValue(new Error("rules unavailable"));
  await expect(purgeExpiredChats()).rejects.toThrow("rules unavailable");
  expect(mocks.remove).not.toHaveBeenCalled();
});
