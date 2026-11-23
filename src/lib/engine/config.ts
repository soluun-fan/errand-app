/**
 * Business constants. All money is integer tögrög (₮).
 * Pricing (docs/decisions.md 2026-11-15 "Pricing"): a build-up price — base + visible extras for
 * time, distance and effort — that the customer may move −20%…+30%; helpers keep 100% of it and
 * the customer pays a small flat service fee. Ops can change the pricing numbers live
 * (`pricing_settings`, /ops/pricing); these are the defaults and what tests use.
 */

export type CategoryId =
  | "shop"
  | "carry"
  | "queue"
  | "deliver"
  | "repair"
  | "other"
  // everyday work added 2026-11-17 (from the PleaseHelp categories)
  | "dayjob"
  | "trash"
  | "escort"
  | "assembly"
  // specialized work (docs/decisions.md 2026-11-16 "Specialized work")
  | "plumbing"
  | "electrical"
  | "cleaning"
  | "childcare"
  | "eldercare";

/**
 * Who may take a kind of task:
 * - "open": any approved helper who works in it
 * - "pro":  a worker vouched for by an approved organisation, or an individual whose certificate Ops checked
 * - "care": legacy eligibility required an approved agency and a criminal-record check;
 *           care is paused for launch and requires a separate review before reopening
 * A safety rule, so it lives in code; `category_settings.trust` mirrors it (a test keeps them equal).
 */
export type Trust = "open" | "pro" | "care";

export interface CategoryConfig {
  id: CategoryId;
  trust: Trust;
  /** Check window after "Done" for this kind of task (a leak shows up later than a missing item). */
  checkHours?: number;
  /** Whether the post form should default to an item budget. */
  items: boolean;
  /** How long the post form assumes the job takes until the customer says otherwise. */
  minutes: number;
}

export const CATEGORIES: readonly CategoryConfig[] = [
  { id: "shop", trust: "open", items: true, minutes: 30 },
  { id: "carry", trust: "open", items: false, minutes: 30 },
  { id: "queue", trust: "open", items: false, minutes: 60 },
  { id: "deliver", trust: "open", items: true, minutes: 30 },
  { id: "repair", trust: "open", items: false, minutes: 60 },
  { id: "other", trust: "open", items: false, minutes: 60 },
  { id: "dayjob", trust: "open", items: false, minutes: 240 },
  { id: "trash", trust: "open", items: false, minutes: 30 },
  // adults only: children and patients are care work (legacy agency + record-check gate)
  { id: "escort", trust: "open", items: false, minutes: 120 },
  { id: "assembly", trust: "open", items: false, minutes: 60 },
  { id: "plumbing", trust: "pro", items: true, minutes: 60, checkHours: 72 },
  { id: "electrical", trust: "pro", items: true, minutes: 60, checkHours: 72 },
  { id: "cleaning", trust: "pro", items: false, minutes: 120 },
  { id: "childcare", trust: "care", items: false, minutes: 180 },
  { id: "eldercare", trust: "care", items: false, minutes: 180 },
];

/** Direct care is outside the launch offering. Historical bookings still use the full catalog. */
export const LAUNCH_CATEGORIES = CATEGORIES.filter((c) => c.trust !== "care");

/** The everyday kinds anyone verified can do (Home's main grid, the helper sign-up form). */
export const OPEN_CATEGORIES: readonly CategoryId[] = CATEGORIES.filter((c) => c.trust === "open").map((c) => c.id);

export const customerChoosesHelper = (id: CategoryId) => id === "escort" || categoryTrust(id) === "care";
export const categoryTrust = (id: CategoryId): Trust => categoryConfig(id).trust;

/** Tasks with a pickup and a drop-off (distance and a pickup pin apply); others happen in one place. */
// "other" and "escort" too (owner 2026-11-17): "take the keys there and come back" is priced by
// distance, and the way back (round trip) costs a share of it (roundTripBps, 50% by default).
export const TWO_POINT_CATEGORIES: readonly CategoryId[] = ["shop", "deliver", "carry", "other", "escort"];

/** Flat service fee by task price: the first tier whose `below` is above the price (null = any). */
export interface FeeTier {
  below: number | null;
  fee: number;
}

export interface EngineConfig {
  /** Lowest task price by day (night adds `nightFee`) — for kinds without their own minimum. */
  minFee: number;
  /**
   * More active tasks cost a little more (owner, 2026-11-18): a customer's first `freeOpenTasks`
   * active tasks pay the normal service fee; each one beyond adds `extraTaskFee`. Ops: pricing.
   */
  freeOpenTasks: number;
  extraTaskFee: number;
  /**
   * Highest job total = price + shopping budget (V1 spec C3: pilot cap 200,000₮). Ops: pricing.
   * Counter-offers and price changes are held to the cap saved on the task at posting.
   */
  maxJobTotal: number;
  /** Suggested price pre-filled on posting = minimum × this (12500 = ×1.25), rounded up. Ops: pricing. */
  suggestBps: number;
  /** Payment window for tasks booked for later / not urgent (V1 spec C5: 30 min; "now" keeps paymentWindowMinutes). */
  paymentWindowBookedMinutes: number;
  /** New tasks: "held" (we take the full amount — managed service) or "direct" (only our fee). Ops: platform_rules.pay_mode. */
  payMode: "held" | "direct";
  /** A kind's own lowest price (easy work lower, hard work higher). Ops: category_settings.min_fee. */
  kindMinFee: Partial<Record<CategoryId, number>>;
  /** Hourly kinds (day jobs, care): the lowest pay per hour; the minimum is this × hours. */
  kindMinHourly: Partial<Record<CategoryId, number>>;
  /** Flat service fee the customer pays on top of the task price (SafePay buyers too). */
  serviceFeeTiers: readonly FeeTier[];
  /** Service fee as a share of the helper's price (1000 = 10%); 0 = the flat steps above. */
  serviceFeeBps: number;
  serviceFeeMin: number;
  serviceFeeMax: number;
  /** A customer's first paid task has no service fee (Ops switch). */
  firstTaskFree: boolean;
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
  /** A chosen helper may back out this long after being chosen without a penalty (owner, 2026-11-17). */
  backOutGraceMinutes: number;
  /** Helper standards (2026-11-22): arrive (start) within this long of being chosen ("now" tasks)… */
  arriveMinutes: number;
  /** …late after this much more; then the customer may cancel free or get another helper. */
  lateGraceMinutes: number;
  titleMax: number;
  descriptionMax: number;
  /** Carrying up stairs without a lift: per floor above the first. */
  carryPerFloor: number;
  /** Round trip ("Буцаж ирэх"): return leg costs this share of the distance part (5000 = 50%). */
  roundTripBps: number;
  /** Travel time per km in UB traffic, per leg — fills in "About how long?" for two-place tasks. */
  travelMinPerKm: number;
  /** Care work pilot (docs/decisions.md 2026-11-17 "Care pilot"): daytime only, at most this long. */
  careDayStartHour: number;
  careDayEndHour: number;
  careMaxMinutes: number;
  /** Buy-for-me: optional extra held on top of the item budget, refunded if unused (1000 = 10%). */
  budgetBufferBps: number;
  /** Instant tasks: a helper's application lapses after this long (they may be busy by then). */
  applicationMinutes: number;
  /** "Choose for me": the system picks the best applicant this long after the first one applied. */
  autoPickMinutes: number;
  /** Direct request that may open to everyone: how long the invited helper has it to themselves. */
  inviteMinutes: number;
  /** …the same for a task booked for later (more time to answer). */
  inviteMinutesScheduled: number;
}

export const DEFAULT_CONFIG: EngineConfig = {
  minFee: 5000,
  maxJobTotal: 200_000,
  suggestBps: 12_500,
  paymentWindowBookedMinutes: 30,
  payMode: "held",
  freeOpenTasks: 3,
  extraTaskFee: 500,
  // per-kind minimums live in the database (category_settings.min_fee / min_hourly, edited at
  // /ops/pricing; starting values in migration 20261117070000) — the engine default is flat
  kindMinFee: {},
  kindMinHourly: {},
  // "Service & safety fee" on the job total (V1 spec C4); live values in pricing_settings
  serviceFeeTiers: [
    { below: 10000, fee: 1000 },
    { below: 30000, fee: 1500 },
    { below: 60000, fee: 2000 },
    { below: null, fee: 3000 },
  ],
  serviceFeeBps: 1000,
  serviceFeeMin: 500,
  serviceFeeMax: 5000,
  firstTaskFree: true,
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
  backOutGraceMinutes: 10,
  arriveMinutes: 45,
  lateGraceMinutes: 15,
  titleMax: 40,
  descriptionMax: 500,
  carryPerFloor: 1500,
  roundTripBps: 5000,
  travelMinPerKm: 3,
  careDayStartHour: 8,
  careDayEndHour: 21,
  careMaxMinutes: 360,
  budgetBufferBps: 1000,
  applicationMinutes: 15,
  autoPickMinutes: 3,
  inviteMinutes: 15,
  inviteMinutesScheduled: 180,
};

export const HOUR_MS = 3_600_000;
export const MINUTE_MS = 60_000;

export function categoryConfig(id: CategoryId): CategoryConfig {
  const c = CATEGORIES.find((x) => x.id === id);
  if (!c) throw new Error(`Unknown category: ${id}`);
  return c;
}
