/**
 * Helpers work from a phone with location and notifications on (owner, 2026-11-18: "errands should
 * run on phones … mandatory location on or else no errand … mandatory notification"). Pure rules,
 * shared by the server check and its tests.
 */
export type ReadyStep = "phone" | "notifications" | "location";

/** How fresh the helper's last known position must be to apply or start a job. */
export const POSITION_FRESH_MS = 15 * 60_000;

export function desktopWorkAllowed(profile: { desktop_work_enabled?: boolean }): boolean {
  return profile.desktop_work_enabled === true;
}

/**
 * A phone or tablet browser. `ch-mobile` is the Client Hint ("?1" on Android Chrome); the user
 * agent covers iPhone / iPad / other Android browsers. Desktop browsers (even narrow windows) fail.
 */
export function isMobileDevice(userAgent: string | null, chMobile: string | null = null): boolean {
  if (chMobile === "?1") return true;
  const ua = userAgent ?? "";
  if (/iPhone|iPod|Android.+Mobile|Mobile Safari|Windows Phone|Opera Mini|IEMobile/i.test(ua)) return true;
  // iPadOS reports as a Mac; a tablet is fine for work too
  if (/iPad|Android/i.test(ua)) return true;
  return false;
}

export function missingSteps(input: { userAgent: string | null; chMobile: string | null; pushDevices: number; positionAt: number | null; now: number }): ReadyStep[] {
  const out: ReadyStep[] = [];
  if (!isMobileDevice(input.userAgent, input.chMobile)) out.push("phone");
  if (input.pushDevices < 1) out.push("notifications");
  if (input.positionAt === null || input.now - input.positionAt > POSITION_FRESH_MS) out.push("location");
  return out;
}
