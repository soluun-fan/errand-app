import "server-only";
import { isActiveTestHelper } from "@/lib/helper-test-mode";
import { cookies, headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { missingSteps, type ReadyStep } from "@/lib/work-ready-rules";

/**
 * Server side of "ready to work" (docs/decisions.md 2026-11-18 "Phone, location, notifications"):
 * going online, applying and starting a job need a phone browser, a saved push subscription and a
 * recent position. The browser shows the same checklist with a button per step; this is the check
 * a modified page can't skip.
 *
 * Browser tests can't hold a real push subscription, so the test server sets E2E_DEVICE_BYPASS=1 and
 * the tests send the `e2e-device` cookie. Production never sets the variable, so the cookie does nothing.
 */
export async function deviceCheckBypassed(profile: { test_helper?: boolean }): Promise<boolean> {
  if (isActiveTestHelper(profile)) return true;
  if (process.env.E2E_DEVICE_BYPASS !== "1") return false;
  return (await cookies()).get("e2e-device")?.value === "ok";
}

export async function workReadyMissing(profile: { id: string; test_helper?: boolean }): Promise<ReadyStep[]> {
  if (await deviceCheckBypassed(profile)) return [];
  const h = await headers();
  const db = createAdminClient();
  const [{ count }, { data: pos }] = await Promise.all([
    db.from("push_subscriptions").select("id", { count: "exact", head: true }).eq("user_id", profile.id),
    db.from("helper_presence").select("lat, updated_at").eq("user_id", profile.id).maybeSingle<{ lat: number | null; updated_at: string }>(),
  ]);
  return missingSteps({
    userAgent: h.get("user-agent"),
    chMobile: h.get("sec-ch-ua-mobile"),
    pushDevices: count ?? 0,
    positionAt: pos?.lat != null ? Date.parse(pos.updated_at) : null,
    now: Date.now(),
  });
}
