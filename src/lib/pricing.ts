import "server-only";
import { DbError } from "@/lib/db/deals";
import { DEFAULT_CONFIG, type CategoryId, type EngineConfig, type FeeTier } from "@/lib/engine";
import { cleanTiers } from "@/lib/pricing-rules";
import { getRules } from "@/lib/rules";
import { audit } from "@/lib/safety";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Live pricing (docs/decisions.md 2026-11-15 "Pricing"): the engine's defaults overridden by the
 * one `pricing_settings` row Ops edits at /ops/pricing. Posting uses this; each deal snapshots what
 * it needs, so a change never touches an existing task.
 */
export interface PricingSettings {
  baseFee: number;
  includedMinutes: number;
  includedKm: number;
  perHalfHour: number;
  perKm: number;
  heavyFee: number;
  carryPerFloor: number;
  toolsFee: number;
  nightFee: number;
  roundTripBps: number;
  travelMinPerKm: number;
  cancelFee: number;
  freeOpenTasks: number;
  extraTaskFee: number;
  priceDownBps: number;
  priceUpBps: number;
  counterUpBps: number;
  serviceFeeTiers: FeeTier[];
  /** Service fee share of the price (1000 = 10%), with a floor and a cap; 0 = the flat steps. */
  serviceFeeBps: number;
  serviceFeeMin: number;
  serviceFeeMax: number;
  /** A customer's first paid task has no service fee. */
  firstTaskFree: boolean;
  nightStartHour: number;
  nightEndHour: number;
  /** Suggested price = minimum × this (12500 = ×1.25), pre-filled on posting (V1 spec C3). */
  suggestBps: number;
  /** Highest job total (price + shopping budget), V1 spec C3. */
  maxJobTotal: number;
}

interface Row {
  base_fee: number;
  included_minutes: number;
  included_km: number;
  per_half_hour: number;
  per_km: number;
  heavy_fee: number;
  per_floor: number;
  tools_fee: number;
  night_fee: number;
  round_trip_bps: number;
  travel_min_per_km: number;
  cancel_fee: number;
  free_open_tasks: number;
  extra_task_fee: number;
  price_down_bps: number;
  price_up_bps: number;
  counter_up_bps: number;
  service_fee_tiers: unknown;
  service_fee_bps?: number;
  service_fee_min?: number;
  service_fee_max?: number;
  first_task_free?: boolean;
  night_start_hour?: number;
  night_end_hour?: number;
  suggest_bps: number;
  max_job_total: number;
}

export async function getPricing(): Promise<PricingSettings> {
  const { data, error } = await createAdminClient().from("pricing_settings").select("*").single<Row>();
  if (error || !data) throw new DbError(error ?? { message: "pricing_settings row missing" });
  return {
    baseFee: data.base_fee,
    includedMinutes: data.included_minutes,
    includedKm: data.included_km,
    perHalfHour: data.per_half_hour,
    perKm: data.per_km,
    heavyFee: data.heavy_fee,
    carryPerFloor: data.per_floor,
    toolsFee: data.tools_fee,
    nightFee: data.night_fee,
    roundTripBps: data.round_trip_bps,
    travelMinPerKm: data.travel_min_per_km ?? DEFAULT_CONFIG.travelMinPerKm,
    cancelFee: data.cancel_fee ?? DEFAULT_CONFIG.cancelFee,
    freeOpenTasks: data.free_open_tasks ?? DEFAULT_CONFIG.freeOpenTasks,
    extraTaskFee: data.extra_task_fee ?? DEFAULT_CONFIG.extraTaskFee,
    priceDownBps: data.price_down_bps,
    priceUpBps: data.price_up_bps,
    counterUpBps: data.counter_up_bps,
    serviceFeeTiers: cleanTiers(data.service_fee_tiers) ?? [...DEFAULT_CONFIG.serviceFeeTiers],
    serviceFeeBps: data.service_fee_bps ?? DEFAULT_CONFIG.serviceFeeBps,
    serviceFeeMin: data.service_fee_min ?? DEFAULT_CONFIG.serviceFeeMin,
    serviceFeeMax: data.service_fee_max ?? DEFAULT_CONFIG.serviceFeeMax,
    firstTaskFree: data.first_task_free ?? DEFAULT_CONFIG.firstTaskFree,
    nightStartHour: data.night_start_hour ?? DEFAULT_CONFIG.nightStartHour,
    nightEndHour: data.night_end_hour ?? DEFAULT_CONFIG.nightEndHour,
    suggestBps: data.suggest_bps ?? DEFAULT_CONFIG.suggestBps,
    maxJobTotal: data.max_job_total ?? DEFAULT_CONFIG.maxJobTotal,
  };
}

/** Engine config with today's prices. The base is also the day minimum. */
export function withPricing(p: PricingSettings, cfg: EngineConfig = DEFAULT_CONFIG): EngineConfig {
  return { ...cfg, ...p, minFee: p.baseFee };
}

/** Per-kind floors (category_settings.min_fee / min_hourly); null = the general minimum. */
export interface KindMinimum {
  category: CategoryId;
  minFee: number | null;
  minHourly: number | null;
}

export async function kindMinimums(): Promise<KindMinimum[]> {
  const { data, error } = await createAdminClient().from("category_settings").select("category, min_fee, min_hourly").returns<{ category: CategoryId; min_fee: number | null; min_hourly: number | null }[]>();
  if (error) throw new DbError(error);
  return (data ?? []).map((r) => ({ category: r.category, minFee: r.min_fee, minHourly: r.min_hourly }));
}

/**
 * Everything the engine needs from the database for a new task: today's prices, each kind's
 * minimum, and the Ops rules (timings, limits, care hours).
 */
export async function pricingConfig(): Promise<EngineConfig> {
  const [p, kinds, r] = await Promise.all([getPricing(), kindMinimums(), getRules()]);
  const cfg = withPricing(p);
  return {
    ...cfg,
    paymentWindowMinutes: r.paymentWindowMinutes,
    paymentWindowBookedMinutes: r.paymentWindowBookedMinutes,
    backOutGraceMinutes: r.backOutGraceMinutes,
    arriveMinutes: r.arriveMinutes,
    lateGraceMinutes: r.lateGraceMinutes,
    settleHours: r.settleHours,
    absentGraceMinutes: r.absentGraceMinutes,
    maxDelayMinutes: r.maxDelayMinutes,
    nowMatchWindowMinutes: r.nowMatchWindowMinutes,
    scheduleMatchWindowMinutes: r.scheduleMatchWindowHours * 60,
    applicationMinutes: r.applicationMinutes,
    autoPickMinutes: r.autoPickMinutes,
    inviteMinutes: r.inviteMinutes,
    inviteMinutesScheduled: r.inviteMinutesScheduled,
    maxApplicants: r.maxApplicants,
    errandCheckHours: r.checkHours,
    careDayStartHour: r.careDayStartHour,
    careDayEndHour: r.careDayEndHour,
    careMaxMinutes: r.careMaxMinutes,
    // managed service (V1 spec A1): the full amount comes to us, through wire.mn or the mock alike
    payMode: r.payMode,
    kindMinFee: Object.fromEntries(kinds.filter((k) => k.minFee !== null).map((k) => [k.category, k.minFee as number])),
    kindMinHourly: Object.fromEntries(kinds.filter((k) => k.minHourly !== null).map((k) => [k.category, k.minHourly as number])),
  };
}

/** Ops only (the caller checks): set one kind's floor — a fixed minimum or an hourly one (or neither). Logged. */
export async function updateKindMinimum(opsId: string, next: KindMinimum): Promise<void> {
  const db = createAdminClient();
  const { data: before } = await db.from("category_settings").select("min_fee, min_hourly").eq("category", next.category).single();
  await db.from("category_settings").update({ min_fee: next.minFee, min_hourly: next.minHourly }).eq("category", next.category).throwOnError();
  await audit(opsId, "pricing.kindMin", next.category, { before, after: { min_fee: next.minFee, min_hourly: next.minHourly } });
}

/** Ops only (caller checks and validates). Logged with before/after. */
export async function updatePricing(opsId: string, next: PricingSettings): Promise<void> {
  const before = await getPricing();
  await createAdminClient()
    .from("pricing_settings")
    .update({
      base_fee: next.baseFee,
      included_minutes: next.includedMinutes,
      included_km: next.includedKm,
      per_half_hour: next.perHalfHour,
      per_km: next.perKm,
      heavy_fee: next.heavyFee,
      per_floor: next.carryPerFloor,
      tools_fee: next.toolsFee,
      night_fee: next.nightFee,
      round_trip_bps: next.roundTripBps,
      travel_min_per_km: next.travelMinPerKm,
      cancel_fee: next.cancelFee,
      free_open_tasks: next.freeOpenTasks,
      extra_task_fee: next.extraTaskFee,
      price_down_bps: next.priceDownBps,
      price_up_bps: next.priceUpBps,
      counter_up_bps: next.counterUpBps,
      service_fee_tiers: next.serviceFeeTiers,
      service_fee_bps: next.serviceFeeBps,
      service_fee_min: next.serviceFeeMin,
      service_fee_max: next.serviceFeeMax,
      first_task_free: next.firstTaskFree,
      night_start_hour: next.nightStartHour,
      night_end_hour: next.nightEndHour,
      suggest_bps: next.suggestBps,
      max_job_total: next.maxJobTotal,
      updated_at: new Date().toISOString(),
      updated_by: opsId,
    })
    .eq("id", true)
    .throwOnError();
  await audit(opsId, "pricing.update", "platform", { before, after: next });
}
