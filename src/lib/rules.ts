import "server-only";
import { DbError } from "@/lib/db/deals";
import { WAVES, type Wave } from "@/lib/dispatch/plan";
import { audit } from "@/lib/safety";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Timings and limits Ops can tune without a new release (docs/decisions.md 2026-11-18 "Rules from
 * the database"): the single `platform_rules` row, edited at /ops/rules. Tasks copy the timings they
 * need at posting, so a change applies to new tasks only. Money math and access rules stay in code.
 */
export interface PlatformRules {
  paymentWindowMinutes: number;
  backOutGraceMinutes: number;
  nowMatchWindowMinutes: number;
  scheduleMatchWindowHours: number;
  applicationMinutes: number;
  autoPickMinutes: number;
  inviteMinutes: number;
  inviteMinutesScheduled: number;
  maxApplicants: number;
  checkHours: number;
  pauseDaysFirst: number;
  pauseDaysSecond: number;
  pauseDaysMore: number;
  carePauseDays: number;
  careDayStartHour: number;
  careDayEndHour: number;
  careMaxMinutes: number;
  careCallMinSeconds: number;
  dispatchWaves: Wave[];
}

interface Row {
  payment_window_minutes: number;
  back_out_grace_minutes: number;
  now_match_window_minutes: number;
  schedule_match_window_hours: number;
  application_minutes: number;
  auto_pick_minutes: number;
  invite_minutes: number;
  invite_minutes_scheduled: number;
  max_applicants: number;
  check_hours: number;
  pause_days_first: number;
  pause_days_second: number;
  pause_days_more: number;
  care_pause_days: number;
  care_day_start_hour: number;
  care_day_end_hour: number;
  care_max_minutes: number;
  care_call_min_seconds: number;
  dispatch_waves: unknown;
}

/** Waves as stored, checked; anything odd falls back to the built-in waves (never breaks dispatch). */
export function cleanWaves(raw: unknown): Wave[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 8) return [...WAVES];
  const ok = raw.every(
    (w) =>
      w && typeof w === "object" &&
      Number.isFinite(w.radiusKm) && w.radiusKm > 0 && w.radiusKm <= 1000 &&
      Number.isInteger(w.max) && w.max >= 1 && w.max <= 200 &&
      Number.isInteger(w.seconds) && w.seconds >= 0 && w.seconds <= 3600,
  );
  return ok ? raw.map((w) => ({ radiusKm: Number(w.radiusKm), max: Number(w.max), seconds: Number(w.seconds) })) : [...WAVES];
}

export async function getRules(): Promise<PlatformRules> {
  const { data, error } = await createAdminClient().from("platform_rules").select("*").single<Row>();
  if (error || !data) throw new DbError(error ?? { message: "platform_rules row missing" });
  return {
    paymentWindowMinutes: data.payment_window_minutes,
    backOutGraceMinutes: data.back_out_grace_minutes,
    nowMatchWindowMinutes: data.now_match_window_minutes,
    scheduleMatchWindowHours: data.schedule_match_window_hours,
    applicationMinutes: data.application_minutes,
    autoPickMinutes: data.auto_pick_minutes,
    inviteMinutes: data.invite_minutes,
    inviteMinutesScheduled: data.invite_minutes_scheduled,
    maxApplicants: data.max_applicants,
    checkHours: data.check_hours,
    pauseDaysFirst: data.pause_days_first,
    pauseDaysSecond: data.pause_days_second,
    pauseDaysMore: data.pause_days_more,
    carePauseDays: data.care_pause_days,
    careDayStartHour: data.care_day_start_hour,
    careDayEndHour: data.care_day_end_hour,
    careMaxMinutes: data.care_max_minutes,
    careCallMinSeconds: data.care_call_min_seconds,
    dispatchWaves: cleanWaves(data.dispatch_waves),
  };
}

/** Ops only (the caller checks and validates). The database checks every range too. Logged with before/after. */
export async function updateRules(opsId: string, next: PlatformRules): Promise<void> {
  const before = await getRules();
  await createAdminClient()
    .from("platform_rules")
    .update({
      payment_window_minutes: next.paymentWindowMinutes,
      back_out_grace_minutes: next.backOutGraceMinutes,
      now_match_window_minutes: next.nowMatchWindowMinutes,
      schedule_match_window_hours: next.scheduleMatchWindowHours,
      application_minutes: next.applicationMinutes,
      auto_pick_minutes: next.autoPickMinutes,
      invite_minutes: next.inviteMinutes,
      invite_minutes_scheduled: next.inviteMinutesScheduled,
      max_applicants: next.maxApplicants,
      check_hours: next.checkHours,
      pause_days_first: next.pauseDaysFirst,
      pause_days_second: next.pauseDaysSecond,
      pause_days_more: next.pauseDaysMore,
      care_pause_days: next.carePauseDays,
      care_day_start_hour: next.careDayStartHour,
      care_day_end_hour: next.careDayEndHour,
      care_max_minutes: next.careMaxMinutes,
      care_call_min_seconds: next.careCallMinSeconds,
      dispatch_waves: next.dispatchWaves,
      updated_at: new Date().toISOString(),
      updated_by: opsId,
    })
    .eq("id", true)
    .throwOnError();
  await audit(opsId, "rules.update", "platform", { before, after: next });
}
