import { beforeEach, expect, it, vi } from "vitest";

const { results, queries, rpcs } = vi.hoisted(() => ({
  results: [] as { data: unknown; error?: { code: string; message: string } }[],
  queries: [] as { table: string; operation: string; filters: [string, unknown][] }[],
  rpcs: [] as { fn: string; args: unknown }[],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc(fn: string, args: unknown) {
    rpcs.push({ fn, args });
    const done = { throwOnError: () => done, then: (resolve: (r: unknown) => unknown) => Promise.resolve({ data: 1 }).then(resolve) };
    return done;
  },
  from(table: string) {
    const query = { table, operation: "", filters: [] as [string, unknown][] };
    queries.push(query);
    let throws = false;
    const builder = {
      select() { query.operation ||= "select"; return builder; },
      update() { query.operation = "update"; return builder; },
      eq(key: string, value: unknown) { query.filters.push([key, value]); return builder; },
      in(key: string, value: unknown) { query.filters.push([key, value]); return builder; },
      maybeSingle() { return builder; },
      returns() { return builder; },
      throwOnError() { throws = true; return builder; },
      then(resolve: (r: unknown) => unknown, reject: (e: unknown) => unknown) {
        const result = results.shift();
        return (throws && result?.error ? Promise.reject(result.error) : Promise.resolve(result)).then(resolve, reject);
      },
    };
    return builder;
  },
}) }));

import { customerJobLocation, saveWorkerLocation, workerLocationState } from "../job-location";
import { recipientVerificationForOwner } from "../verify-mn";

beforeEach(() => { results.length = 0; queries.length = 0; rpcs.length = 0; });

it("does not read worker locations for a different customer or a finished job", async () => {
  for (const data of [null, { helper_id: "helper", status: "check" }]) {
    queries.length = 0;
    results.push({ data });
    expect((await customerJobLocation("deal", "viewer")).position).toBeNull();
    expect(queries).toHaveLength(1);
    expect(queries[0].filters).toContainEqual(["customer_id", "viewer"]);
  }
});

it("reads only the current assigned helper's opted-in job, with its sample timestamp", async () => {
  results.push({ data: { helper_id: "helper", status: "in_progress" } },
    { data: { lat: 47.92, lng: 106.92, updated_at: "2026-11-20T07:00:00Z" } });
  const state = await customerJobLocation("deal", "customer");
  expect(state.sharing).toBe(true);
  expect(state.position?.updatedAt).toBe(Date.parse("2026-11-20T07:00:00Z"));
  expect(queries[1].filters).toEqual([["deal_id", "deal"], ["helper_id", "helper"]]);
});

it("keeps the task page usable when the tracking migration is missing", async () => {
  results.push({ data: { helper_id: "helper", status: "in_progress" } },
    { data: null, error: { code: "PGRST205", message: "Missing job_locations" } });
  expect(await customerJobLocation("deal", "customer")).toEqual({ available: false, sharing: false, position: null });
});

it("preserves online presence when the optional tracking table is unavailable", async () => {
  results.push({ data: { online: true } }, { data: null, error: { code: "PGRST205", message: "Missing job_locations" } });
  expect(await workerLocationState("helper")).toEqual({ online: true, available: false, jobIds: [] });
});

it("updates online presence and records running jobs for the authenticated helper only", async () => {
  results.push({ data: { online: true } }, { data: [{ deal_id: "shared-job", deals: { status: "in_progress", en_route_at: null } }, { deal_id: "not-yet", deals: { status: "matched", en_route_at: null } }] }, { data: null });
  await saveWorkerLocation("helper", { lat: 47.92, lng: 106.92 });
  expect(queries[1].filters).toContainEqual(["deals.status", ["in_progress", "matched"]]);
  expect(queries[1].filters).toContainEqual(["deals.helper_id", "helper"]);
  expect(queries[2]).toMatchObject({ operation: "update", filters: [["user_id", "helper"], ["online", true]] });
  expect(rpcs).toEqual([{ fn: "record_job_position", args: { p_helper: "helper", p_lat: 47.92, p_lng: 106.92 } }]);
});

it("does not collect coordinates when offline and no jobs have sharing enabled", async () => {
  results.push({ data: { online: false } }, { data: [] });
  await saveWorkerLocation("helper", { lat: 47.92, lng: 106.92 });
  expect(queries.every(q => q.operation === "select")).toBe(true);
});

it("propagates failed writes so the worker never sees a false live status", async () => {
  results.push({ data: { online: true } }, { data: [] }, { data: null, error: { code: "42501", message: "denied" } });
  await expect(saveWorkerLocation("helper", { lat: 47.92, lng: 106.92 })).rejects.toMatchObject({ code: "42501" });
});

it("treats missing optional recipient verification as unavailable without crashing the task", async () => {
  results.push({ data: null, error: { code: "PGRST205", message: "Missing recipient_verifications" } });
  expect(await recipientVerificationForOwner("deal", "customer")).toBeUndefined();
  expect(queries[0].filters).toContainEqual(["owner_id", "customer"]);
});

it("does not hide unrelated recipient-verification database errors", async () => {
  results.push({ data: null, error: { code: "42501", message: "permission denied" } });
  await expect(recipientVerificationForOwner("deal", "customer")).rejects.toThrow("permission denied");
});
