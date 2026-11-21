import { beforeEach, expect, it, vi } from "vitest";

const { getViewer, workReadyMissing, upsert, refresh, rpc, saveWorkerLocation } = vi.hoisted(() => ({
  getViewer: vi.fn(), workReadyMissing: vi.fn(), upsert: vi.fn(), refresh: vi.fn(), rpc: vi.fn(), saveWorkerLocation: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ refresh }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("@/i18n/server", () => ({ getT: async () => (key: string) => key }));
vi.mock("@/lib/auth", () => ({ getViewer }));
vi.mock("@/lib/work-ready", () => ({ workReadyMissing }));
vi.mock("@/lib/payout", () => ({ hasPayout: async () => true }));
vi.mock("@/lib/job-location", () => ({ saveWorkerLocation, workerLocationState: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: () => ({ upsert: (row: unknown) => { upsert(row); return { throwOnError: async () => ({}) }; } }),
  rpc: (name: string, args: unknown) => ({ throwOnError: () => rpc(name, args) }),
}) }));

import { setPresence, setJobLocationSharing, updateWorkerLocation } from "./actions";
import { LEGAL_VERSIONS } from "@/lib/legal-rules";

beforeEach(() => {
  vi.resetAllMocks();
  getViewer.mockResolvedValue({ profile: {
    id: "worker", name: "Worker", age_confirmed_at: "2026-11-21", terms_version: LEGAL_VERSIONS.terms, privacy_version: LEGAL_VERSIONS.privacy,
  }, actor: { helperApproved: true } });
  workReadyMissing.mockResolvedValue([]);
});

function presence(online: boolean) {
  const form = new FormData();
  form.set("online", online ? "on" : "");
  form.set("radius", "3");
  return form;
}

it("returns an actionable error when readiness prevents going online", async () => {
  workReadyMissing.mockResolvedValue(["notifications"]);
  expect(await setPresence(presence(true))).toEqual({ error: "workReady.blocked" });
  expect(upsert).not.toHaveBeenCalled();
});

it("allows going offline after helper approval or device permissions are lost", async () => {
  const viewer = await getViewer();
  viewer.actor.helperApproved = false;
  expect(await setPresence(presence(false))).toEqual({ done: true });
  expect(upsert).toHaveBeenCalledWith({ user_id: "worker", online: false, radius_km: 3 });
  expect(workReadyMissing).not.toHaveBeenCalled();
  expect(refresh).toHaveBeenCalledOnce();
  expect(await setPresence(presence(true))).toEqual({ error: "error.forbidden" });
});

it("uses a fresh position for readiness and stores it only for the authenticated helper", async () => {
  workReadyMissing.mockResolvedValue(["location"]);
  const form = presence(true);
  form.set("lat", "47.92"); form.set("lng", "106.92");
  expect(await setPresence(form)).toEqual({ done: true });
  expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "worker", online: true, lat: 47.92, lng: 106.92 }));
});

it("binds sharing to the signed-in helper and rejects invalid sharing inputs", async () => {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  rpc.mockResolvedValue({ data: true });
  expect(await setJobLocationSharing(id, true)).toBe(true);
  expect(rpc).toHaveBeenCalledWith("set_job_location_sharing", { p_deal: id, p_helper: "worker", p_enabled: true });
  expect(await setJobLocationSharing("invalid", true)).toBe(false);
  expect(rpc).toHaveBeenCalledOnce();
});

it("rejects invalid coordinates before any location writes", async () => {
  await expect(updateWorkerLocation(NaN, 106.92)).rejects.toThrow("Location unavailable");
  expect(saveWorkerLocation).not.toHaveBeenCalled();
});
