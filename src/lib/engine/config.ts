/**
 * Business constants. All money is integer tögrög (₮).
 * Pricing (docs/decisions.md 2026-11-15 "Pricing"): a build-up price — base + visible extras for
 * time, distance and effort — that the customer may move −20%…+30%; helpers keep 100% of it and
 * the customer pays a small flat service fee. Ops can change the pricing numbers live
 * (`pricing_settings`, /ops/pricing); these are the defaults and what tests use.
 */

export type CategoryId = "shop" | "carry" | "queue" | "deliver" | "repair" | "other";

export interface CategoryConfig {
  id: CategoryId;
  /** Whether the post form should default to an item budget. */
  items: boolean;
  /** How long the post form assumes the job takes until the customer says otherwise. */
  minutes: number;
}

export const CATEGORIES: readonly CategoryConfig[] = [
  { id: "shop", items: true, minutes: 30 },
  { id: "carry", items: false, minutes: 30 },
  { id: "queue", items: false, minutes: 60 },
  { id: "deliver", items: true, minutes: 30 },
  { id: "repair", items: false, minutes: 60 },
  { id: "other", items: false, minutes: 60 },
];

/** Tasks with a pickup and a drop-off (distance and a pickup pin apply); others happen in one place. */
export const TWO_POINT_CATEGORIES: readonly CategoryId[] = ["shop", "deliver", "carry"];

/** Flat service fee by task price: the first tier whose `below` is above the price (null = any). */
export interface FeeTier {
  below: number | null;
  fee: number;
}

export interface EngineConfig {
  /** Lowest task price by day (night adds `nightFee`). */
  minFee: number;
  /** Flat service fee the customer pays on top of the task price (SafePay buyers too). */
  serviceFeeTiers: readonly FeeTier[];
  /** Cut taken from the helper's fee in basis points. 0: helpers keep 100% (older deals kept 10%). */
  commissionBps: number;
  /** Fee paid to the helper when the customer cancels after match, before start. */
  cancelFee: number;
  /** Errand check window after "Done". */
  errandCheckHours: number;
  /** Allowed SafePay check windows (seller chooses). */
  goodsCheckHours: readonly number[];
  /** Max applicants on a scheduled errand. */
  maxApplicants: number;
  /** "Now" errand with no helper after this long → expired + full refund. */
  nowMatchWindowMinutes: number;
  /** Scheduled errand without a time and no helper after this long → expired. */
  scheduleMatchWindowMinutes: number;
  /** Build-up price: the base covers this much time and distance. */
  baseFee: number;
  includedMinutes: number;
  includedKm: number;
  /** Each further started 30 minutes. */
  perHalfHour: number;
  /** Each further km. */
  perKm: number;
  heavyFee: number;
  toolsFee: number;
  /** Added for tasks starting at night (local time, see utcOffsetHours). */
  nightFee: number;
  /** Prices are rounded to this step. */
  feeStep: number;
  /** How far the customer may move the recommended price (2000 = 20% lower, 3000 = 30% higher). */
  priceDownBps: number;
  priceUpBps: number;
  /** A helper's counter-offer: at most this much above the customer's price; never below it. */
  counterUpBps: number;
  nightStartHour: number;
  nightEndHour: number;
  /** Ulaanbaatar is UTC+8 all year. */
  utcOffsetHours: number;
  /** After a helper is matched the customer pays within this window, or the helper is released. */
  paymentWindowMinutes: number;
  titleMax: number;
  descriptionMax: number;
  /** Carrying up stairs without a lift: per floor above the first. */
  carryPerFloor: number;
  /** Round trip ("Буцаж ирэх"): return leg costs this share of the distance part (5000 = 50%). */
  roundTripBps: number;
  /** Buy-for-me: optional extra held on top of the item budget, refunded if unused (1000 = 10%). */
  budgetBufferBps: number;
  /** Instant tasks: a helper's application lapses after this long (they may be busy by then). */
  applicationMinutes: number;
  /** "Choose for me": the system picks the best applicant this long after the first one applied. */
  autoPickMinutes: number;
}

export const DEFAULT_CONFIG: EngineConfig = {
  minFee: 5000,
  serviceFeeTiers: [
    { below: 10000, fee: 500 },
    { below: 30000, fee: 1000 },
    { below: 100000, fee: 2000 },
    { below: null, fee: 3000 },
  ],
  commissionBps: 0,
  cancelFee: 3000,
  errandCheckHours: 24,
  goodsCheckHours: [24, 72],
  maxApplicants: 5,
  nowMatchWindowMinutes: 30,
  scheduleMatchWindowMinutes: 24 * 60,
  baseFee: 5000,
  includedMinutes: 30,
  includedKm: 1,
  perHalfHour: 3000,
  perKm: 1500,
  heavyFee: 3000,
  toolsFee: 2000,
  nightFee: 1000,
  feeStep: 500,
  priceDownBps: 2000,
  priceUpBps: 3000,
  counterUpBps: 3000,
  nightStartHour: 22,
  nightEndHour: 7,
  utcOffsetHours: 8,
  paymentWindowMinutes: 10,
  titleMax: 40,
  descriptionMax: 500,
  carryPerFloor: 1500,
  roundTripBps: 5000,
  budgetBufferBps: 1000,
  applicationMinutes: 15,
  autoPickMinutes: 3,
};

export const HOUR_MS = 3_600_000;
export const MINUTE_MS = 60_000;

export function categoryConfig(id: CategoryId): CategoryConfig {
  const c = CATEGORIES.find((x) => x.id === id);
  if (!c) throw new Error(`Unknown category: ${id}`);
  return c;
}
