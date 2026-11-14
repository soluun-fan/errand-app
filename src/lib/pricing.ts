import "server-only";
import { DbError } from "@/lib/db/deals";
import { DEFAULT_CONFIG, type EngineConfig, type FeeTier } from "@/lib/engine";
import { cleanTiers } from "@/lib/pricing-rules";
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
  priceDownBps: number;
  priceUpBps: number;
  counterUpBps: number;
  serviceFeeTiers: FeeTier[];
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
  price_down_bps: number;
  price_up_bps: number;
  counter_up_bps: number;
  service_fee_tiers: unknown;
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
    priceDownBps: data.price_down_bps,
    priceUpBps: data.price_up_bps,
    counterUpBps: data.counter_up_bps,
    serviceFeeTiers: cleanTiers(data.service_fee_tiers) ?? [...DEFAULT_CONFIG.serviceFeeTiers],
  };
}

/** Engine config with today's prices. The base is also the day minimum. */
export function withPricing(p: PricingSettings, cfg: EngineConfig = DEFAULT_CONFIG): EngineConfig {
  return { ...cfg, ...p, minFee: p.baseFee };
}

export async function pricingConfig(): Promise<EngineConfig> {
  return withPricing(await getPricing());
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
      price_down_bps: next.priceDownBps,
      price_up_bps: next.priceUpBps,
      counter_up_bps: next.counterUpBps,
      service_fee_tiers: next.serviceFeeTiers,
      updated_at: new Date().toISOString(),
      updated_by: opsId,
    })
    .eq("id", true)
    .throwOnError();
  await audit(opsId, "pricing.update", "platform", { before, after: next });
}
