import "server-only";
import { isActiveTestHelper } from "@/lib/helper-test-mode";
import { cookies, headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { getRules } from "@/lib/rules";
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

/**
 * Ops let this helper work from a computer (profiles.desktop_ok, 2026-11-27): only the phone check
 * is skipped. Read on its own so a database without the column (before the migration) means "no".
 */
export async function computerAllowed(userId: string): Promise<boolean> {
  const { data, error } = await createAdminClient().from("profiles").select("desktop_ok").eq("id", userId).maybeSingle<{ desktop_ok: boolean }>();
  return !error && data?.desktop_ok === true;
}

/**
 * A computer doesn't move, and many can't locate themselves at all (no GPS; Wi-Fi guesses fail): for
 * helpers Ops allowed on a computer, a position — often marked on the map by hand — counts for 12 h.
 */
export const COMPUTER_POSITION_MS = 12 * 3_600_000;

/** For the readiness card: does this computer-allowed helper have a position from the last 12 h? */
export async function computerPositionFresh(userId: string): Promise<boolean> {
  if (!(await computerAllowed(userId))) return false;
  const { data } = await createAdminClient()
    .from("helper_presence")
    .select("lat, updated_at")
    .eq("user_id", userId)
    .maybeSingle<{ lat: number | null; updated_at: string }>();
  return data?.lat != null && Date.now() - Date.parse(data.updated_at) < COMPUTER_POSITION_MS;
}

export async function workReadyMissing(profile: { id: string; test_helper?: boolean }): Promise<ReadyStep[]> {
  if (await deviceCheckBypassed(profile)) return [];
  const computer = await computerAllowed(profile.id);
  const h = await headers();
  const db = createAdminClient();
  const [{ count }, { data: pos }, rules] = await Promise.all([
    db.from("push_subscriptions").select("id", { count: "exact", head: true }).eq("user_id", profile.id).throwOnError(),
    db
      .from("helper_presence")
      .select("lat, updated_at")
      .eq("user_id", profile.id)
      .maybeSingle<{ lat: number | null; updated_at: string }>()
      .throwOnError(),
    getRules(),
  ]);
  const missing = missingSteps({
    userAgent: h.get("user-agent"),
    chMobile: h.get("sec-ch-ua-mobile"),
    pushDevices: count ?? 0,
    positionAt: pos?.lat != null ? Date.parse(pos.updated_at) : null,
    now: Date.now(),
    freshMs: computer ? COMPUTER_POSITION_MS : rules.readyPositionMinutes * 60_000,
  });
  return computer ? missing.filter((s) => s !== "phone") : missing;
}
