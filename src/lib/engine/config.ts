/**
 * Business constants. All money is integer tögrög (₮).
 * Values marked "demo" are placeholders until final pricing is decided (CLAUDE.md §11).
 */

export type CategoryId = "shop" | "carry" | "queue" | "deliver" | "repair" | "other";

export interface CategoryConfig {
  id: CategoryId;
  /** Base for the suggested fee, before distance. */
  base: number;
  /** Whether the post form should default to an item budget. */
  items: boolean;
}

export const CATEGORIES: readonly CategoryConfig[] = [
  { id: "shop", base: 6000, items: true },
  { id: "carry", base: 15000, items: false },
  { id: "queue", base: 8000, items: false },
  { id: "deliver", base: 5000, items: true },
  { id: "repair", base: 12000, items: false },
  { id: "other", base: 7000, items: false },
];

export interface EngineConfig {
  /** Minimum helper fee a customer may set. */
  minFee: number;
  /** Flat service fee charged to the customer per errand (demo). */
  serviceFee: number;
  /** Helper commission in basis points: 1000 = 10% (demo). */
  commissionBps: number;
  /** Fee paid to the helper when the customer cancels after match, before start. */
  cancelFee: number;
  /** Errand check window after "Done". */
  errandCheckHours: number;
  /** Allowed SafePay check windows (seller chooses). */
  goodsCheckHours: readonly number[];
  /** SafePay buyer protection fee in basis points (100 = 1%) and its floor (demo). */
  buyerFeeBps: number;
  buyerFeeMin: number;
  /** Max applicants on a scheduled errand. */
  maxApplicants: number;
  /** "Now" errand with no helper after this long → expired + full refund. */
  nowMatchWindowMinutes: number;
  /** Scheduled errand without a time and no helper after this long → expired. */
  scheduleMatchWindowMinutes: number;
  /** Suggested fee: per-km add-on and rounding step. */
  perKm: number;
  feeStep: number;
  /** Higher minimum fee for tasks starting at night (local time, see utcOffsetHours). */
  nightMinFee: number;
  nightStartHour: number;
  nightEndHour: number;
  /** Ulaanbaatar is UTC+8 all year. */
  utcOffsetHours: number;
  /** An errand not paid within this window expires (nothing to refund). */
  paymentWindowMinutes: number;
  titleMax: number;
  descriptionMax: number;
  /** Carry add-ons (docs/rules.md §Fees). */
  carryPerFloor: number;
  secondPersonFee: number;
}

export const DEFAULT_CONFIG: EngineConfig = {
  minFee: 5000,
  serviceFee: 1000,
  commissionBps: 1000,
  cancelFee: 3000,
  errandCheckHours: 24,
  goodsCheckHours: [24, 72],
  buyerFeeBps: 100,
  buyerFeeMin: 1000,
  maxApplicants: 5,
  nowMatchWindowMinutes: 30,
  scheduleMatchWindowMinutes: 24 * 60,
  perKm: 1500,
  feeStep: 500,
  nightMinFee: 6000,
  nightStartHour: 22,
  nightEndHour: 7,
  utcOffsetHours: 8,
  paymentWindowMinutes: 30,
  titleMax: 40,
  descriptionMax: 500,
  carryPerFloor: 1500,
  secondPersonFee: 15000,
};

export const HOUR_MS = 3_600_000;
export const MINUTE_MS = 60_000;

export function categoryConfig(id: CategoryId): CategoryConfig {
  const c = CATEGORIES.find((x) => x.id === id);
  if (!c) throw new Error(`Unknown category: ${id}`);
  return c;
}
