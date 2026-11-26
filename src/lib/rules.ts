import { toJson } from "@/lib/db/json";
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
  /** New tasks: "held" (the full amount to us — managed service, V1 spec A1) or "direct" (only our fee; older tasks). */
  payMode: "held" | "direct";
  /** Booked / not-urgent tasks: minutes to pay after choosing (V1 spec C5). */
  paymentWindowBookedMinutes: number;
  /** Withdrawals (V1 spec C10): smallest amount, how many a day, unclaimed earnings paid out after N days. */
  withdrawMin: number;
  withdrawalsPerDay: number;
  autoPayoutDays: number;
  /** Day jobs stay one-off help (V1 spec A3): same poster + helper, at most this many in 30 days. */
  dayjobPairMonthCap: number;
  /** Helper standards (2026-11-22) */
  arriveMinutes: number;
  lateGraceMinutes: number;
  arriveRadiusM: number;
  positionMaxAgeSeconds: number;
  locationStaleMinutes: number;
  routeRetentionDays: number;
  marksWindowDays: number;
  marksRankLower: number;
  marksPause: number;
  marksPauseDays: number;
  marksReview: number;
  /** "Want to raise the price?" after this long without an application. */
  nudgeAfterMinutes: number;
  maxPendingApplications: number;
  readyPositionMinutes: number;
  sosRepingMinutes: number;
  sosRepingForMinutes: number;
  chatRetentionDays: number;
  settleHours: number;
  absentGraceMinutes: number;
  /** An unanswered request to pay extra for items over budget lapses after this long (2026-11-27). */
  topUpWaitMinutes: number;
  maxDelayMinutes: number;
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
  pay_mode: string;
  payment_window_booked_minutes: number;
  withdraw_min: number;
  withdrawals_per_day: number;
  auto_payout_days: number;
  dayjob_pair_month_cap: number;
  arrive_minutes?: number;
  late_grace_minutes?: number;
  arrive_radius_m?: number;
  position_max_age_seconds?: number;
  location_stale_minutes?: number;
  route_retention_days?: number;
  marks_window_days?: number;
  marks_rank_lower?: number;
  marks_pause?: number;
  marks_pause_days?: number;
  marks_review?: number;
  nudge_after_minutes?: number;
  max_pending_applications?: number;
  ready_position_minutes?: number;
  sos_reping_minutes?: number;
  sos_reping_for_minutes?: number;
  chat_retention_days?: number;
  settle_hours?: number;
  absent_grace_minutes?: number;
  top_up_wait_minutes?: number;
  max_delay_minutes?: number;
}

/** Waves as stored, checked; anything odd falls back to the built-in waves (never breaks dispatch). */
export function cleanWaves(raw: unknown): Wave[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 8) return [...WAVES];
  const ok = raw.every(
    (w) =>
      w &&
      typeof w === "object" &&
      Number.isFinite(w.radiusKm) &&
      w.radiusKm > 0 &&
      w.radiusKm <= 1000 &&
      Number.isInteger(w.max) &&
      w.max >= 1 &&
      w.max <= 200 &&
      Number.isInteger(w.seconds) &&
      w.seconds >= 0 &&
      w.seconds <= 3600,
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
    payMode: data.pay_mode === "direct" ? "direct" : "held",
    paymentWindowBookedMinutes: data.payment_window_booked_minutes ?? 30,
    withdrawMin: data.withdraw_min ?? 3000,
    withdrawalsPerDay: data.withdrawals_per_day ?? 2,
    autoPayoutDays: data.auto_payout_days ?? 30,
    dayjobPairMonthCap: data.dayjob_pair_month_cap ?? 8,
    arriveMinutes: data.arrive_minutes ?? 45,
    lateGraceMinutes: data.late_grace_minutes ?? 15,
    arriveRadiusM: data.arrive_radius_m ?? 200,
    positionMaxAgeSeconds: data.position_max_age_seconds ?? 120,
    locationStaleMinutes: data.location_stale_minutes ?? 5,
    routeRetentionDays: data.route_retention_days ?? 30,
    marksWindowDays: data.marks_window_days ?? 30,
    marksRankLower: data.marks_rank_lower ?? 2,
    marksPause: data.marks_pause ?? 3,
    marksPauseDays: data.marks_pause_days ?? 3,
    marksReview: data.marks_review ?? 4,
    nudgeAfterMinutes: data.nudge_after_minutes ?? 3,
    maxPendingApplications: data.max_pending_applications ?? 3,
    readyPositionMinutes: data.ready_position_minutes ?? 15,
    sosRepingMinutes: data.sos_reping_minutes ?? 2,
    sosRepingForMinutes: data.sos_reping_for_minutes ?? 30,
    chatRetentionDays: data.chat_retention_days ?? 90,
    settleHours: data.settle_hours ?? 24,
    absentGraceMinutes: data.absent_grace_minutes ?? 10,
    topUpWaitMinutes: data.top_up_wait_minutes ?? 30,
    maxDelayMinutes: data.max_delay_minutes ?? 30,
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
      dispatch_waves: toJson(next.dispatchWaves),
      pay_mode: next.payMode,
      payment_window_booked_minutes: next.paymentWindowBookedMinutes,
      withdraw_min: next.withdrawMin,
      withdrawals_per_day: next.withdrawalsPerDay,
      auto_payout_days: next.autoPayoutDays,
      dayjob_pair_month_cap: next.dayjobPairMonthCap,
      arrive_minutes: next.arriveMinutes,
      late_grace_minutes: next.lateGraceMinutes,
      arrive_radius_m: next.arriveRadiusM,
      position_max_age_seconds: next.positionMaxAgeSeconds,
      location_stale_minutes: next.locationStaleMinutes,
      route_retention_days: next.routeRetentionDays,
      marks_window_days: next.marksWindowDays,
      marks_rank_lower: next.marksRankLower,
      marks_pause: next.marksPause,
      marks_pause_days: next.marksPauseDays,
      marks_review: next.marksReview,
      nudge_after_minutes: next.nudgeAfterMinutes,
      max_pending_applications: next.maxPendingApplications,
      ready_position_minutes: next.readyPositionMinutes,
      sos_reping_minutes: next.sosRepingMinutes,
      sos_reping_for_minutes: next.sosRepingForMinutes,
      chat_retention_days: next.chatRetentionDays,
      settle_hours: next.settleHours,
      absent_grace_minutes: next.absentGraceMinutes,
      top_up_wait_minutes: next.topUpWaitMinutes,
      max_delay_minutes: next.maxDelayMinutes,
      updated_at: new Date().toISOString(),
      updated_by: opsId,
    })
    .eq("id", true)
    .throwOnError();
  await audit(opsId, "rules.update", "platform", { before, after: next });
}
