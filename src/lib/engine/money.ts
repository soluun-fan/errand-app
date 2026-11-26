import { DEFAULT_CONFIG, categoryTrust, type CategoryId, type EngineConfig } from "./config";
import { assertMoney } from "./errors";
import type { Deal, ErrandDetails } from "./types";

/** Integer basis-point percentage, rounded half up (inputs are integers, so this is exact enough). */
export function bps(amount: number, basisPoints: number): number {
  return Math.round((amount * basisPoints) / 10_000);
}

export function commissionFor(fee: number, commissionBps: number): number {
  return bps(fee, commissionBps);
}

export interface ErrandSplit {
  spent: number;
  commission: number;
  /** fee - commission */
  helperFeeNet: number;
  /** fee - commission + spent */
  helperNet: number;
  /** itemBudget - spent, back to the customer */
  refund: number;
  /** serviceFee + commission */
  platform: number;
  /** itemBudget + fee + serviceFee */
  held: number;
}

export function errandSplit(input: {
  fee: number;
  itemBudget: number;
  receipt: number | null;
  serviceFee: number;
  commissionBps: number;
}): ErrandSplit {
  const { fee, itemBudget, receipt, serviceFee, commissionBps } = input;
  assertMoney(fee, "fee");
  assertMoney(itemBudget, "itemBudget");
  assertMoney(serviceFee, "serviceFee");
  if (receipt !== null) assertMoney(receipt, "receipt");

  const spent = receipt === null ? 0 : Math.min(receipt, itemBudget);
  const commission = commissionFor(fee, commissionBps);
  const helperFeeNet = fee - commission;
  return {
    spent,
    commission,
    helperFeeNet,
    helperNet: helperFeeNet + spent,
    refund: itemBudget - spent,
    platform: serviceFee + commission,
    held: itemBudget + fee + serviceFee,
  };
}

/** Flat steps on an amount (the older service fee; SafePay buyer protection still uses it). */
export function tieredFee(amount: number, cfg: EngineConfig = DEFAULT_CONFIG): number {
  assertMoney(amount, "amount");
  const tier = cfg.serviceFeeTiers.find((x) => x.below === null || amount < x.below) ?? cfg.serviceFeeTiers[cfg.serviceFeeTiers.length - 1];
  return tier.fee;
}

/**
 * The customer's service fee (docs/decisions.md 2026-11-22 "Service fee"): a share of the helper's
 * price, rounded to 100₮, between a floor and a cap — small jobs pay little, bigger jobs carry the
 * business; nothing on the shopping money. Helpers keep 100%. With `serviceFeeBps` 0 Ops falls back
 * to the flat steps on price + shopping budget (the earlier rule).
 */
export function serviceFeeFor(price: number, cfg: EngineConfig = DEFAULT_CONFIG, itemBudget = 0): number {
  assertMoney(price, "price");
  assertMoney(itemBudget, "itemBudget");
  if (!(cfg.serviceFeeBps > 0)) return tieredFee(price + itemBudget, cfg);
  const share = Math.round((price * cfg.serviceFeeBps) / 10_000 / 100) * 100;
  return Math.min(cfg.serviceFeeMax, Math.max(cfg.serviceFeeMin, share));
}

/** The price pre-filled on posting: the minimum × suggestBps, rounded up to the price step (V1 spec C3). */
export function suggestedPrice(min: number, cfg: EngineConfig = DEFAULT_CONFIG): number {
  assertMoney(min, "min");
  const step = cfg.feeStep > 0 ? cfg.feeStep : 1;
  return Math.ceil((min * cfg.suggestBps) / 10_000 / step) * step;
}

/** SafePay buyer protection: the flat steps. */
export function buyerFeeFor(price: number, cfg: EngineConfig = DEFAULT_CONFIG): number {
  return tieredFee(price, cfg);
}

/** What the payer must put into the hold. */
export function amountDue(deal: Deal): number {
  if (deal.type !== "errand") return deal.price + deal.buyerFee;
  // direct: only our service fee goes through the provider; the helper is paid by the customer
  return deal.payMode === "direct" ? deal.serviceFee : deal.itemBudget + deal.fee + deal.serviceFee;
}

/** True if `atMs` falls in the night window in local (Ulaanbaatar) time. */
export function isNight(atMs: number, cfg: EngineConfig = DEFAULT_CONFIG): boolean {
  const hour = Math.floor(((atMs / 3_600_000 + cfg.utcOffsetHours) % 24) + 24) % 24;
  return cfg.nightStartHour > cfg.nightEndHour
    ? hour >= cfg.nightStartHour || hour < cfg.nightEndHour
    : hour >= cfg.nightStartHour && hour < cfg.nightEndHour;
}

/**
 * "About how long?" suggestion: the kind of task's usual time plus the travel there (and back, for a
 * round trip), in 30-minute steps, at most 8 hours. The customer can still pick another length.
 */
export function suggestedMinutes(usual: number, km: number, roundTrip: boolean, cfg: EngineConfig = DEFAULT_CONFIG): number {
  const travel = Math.max(0, km) * cfg.travelMinPerKm * (roundTrip ? 2 : 1);
  return Math.min(480, Math.max(30, Math.ceil((usual + travel) / 30) * 30));
}

/** Care pilot: starts and ends within the day window (UB time), and is no longer than allowed. */
export function careTimeOk(startMs: number, minutes: number, cfg: EngineConfig = DEFAULT_CONFIG): boolean {
  const local = (((startMs / 60_000 + cfg.utcOffsetHours * 60) % 1440) + 1440) % 1440; // minutes after local midnight
  return minutes <= cfg.careMaxMinutes && local >= cfg.careDayStartHour * 60 && local + minutes <= cfg.careDayEndHour * 60;
}

/**
 * This task's lowest price (owner, 2026-11-17): the kind's own minimum — or, for hourly kinds, the
 * hourly floor × hours — plus the trip (distance beyond the included km, and the way back) and the
 * night extra; a second person doubles the labour part. The customer names any price at or above it.
 */
export function taskMinFee(
  category: CategoryId,
  d: Pick<ErrandDetails, "km" | "minutes" | "roundTrip" | "people">,
  atMs: number | undefined,
  cfg: EngineConfig = DEFAULT_CONFIG,
): number {
  const hourly = cfg.kindMinHourly[category];
  const minutes = Number.isFinite(d.minutes) && d.minutes > 0 ? d.minutes : cfg.includedMinutes;
  let labour = hourly ? ceilStep((hourly * minutes) / 60, cfg) : (cfg.kindMinFee[category] ?? cfg.minFee);
  if (d.people === 2) labour *= 2;
  const km = Number.isFinite(d.km) && d.km > 0 ? d.km : 0;
  const trip =
    roundStep(Math.max(0, km - cfg.includedKm) * cfg.perKm, cfg) +
    (d.roundTrip && km > 0 ? roundStep(bps(km * cfg.perKm, cfg.roundTripBps), cfg) : 0);
  return labour + trip + (atMs !== undefined && isNight(atMs, cfg) ? cfg.nightFee : 0);
}

/** The extra service fee for a customer who already has `openTasks` active tasks (0 within the free ones). */
export function extraTaskFeeFor(openTasks: number, cfg: EngineConfig = DEFAULT_CONFIG): number {
  return Number.isInteger(openTasks) && openTasks >= cfg.freeOpenTasks ? cfg.extraTaskFee : 0;
}

/** A kind's advertised "from": its fixed minimum, or its hourly floor (shown per hour). */
export function kindFromLabel(category: CategoryId, cfg: EngineConfig = DEFAULT_CONFIG): { amount: number; hourly: boolean } {
  const h = cfg.kindMinHourly[category];
  if (!h) return { amount: cfg.kindMinFee[category] ?? cfg.minFee, hourly: false };
  // everyday hourly kinds (day jobs) are advertised per job — the usual length × the hourly floor —
  // never "per hour": helpers are contractors paid per task (V1 spec A3). Care keeps its hourly label.
  if (categoryTrust(category) !== "care")
    return { amount: h * Math.max(1, Math.round((cfg.kindMinutes[category] ?? cfg.includedMinutes) / 60)), hourly: false };
  return { amount: h, hourly: true };
}

/** The lowest "from" price to advertise: the cheapest fixed minimum among these kinds. */
export function lowestMinFee(kinds: readonly CategoryId[], cfg: EngineConfig = DEFAULT_CONFIG): number {
  const fixed = kinds.filter((k) => !cfg.kindMinHourly[k]).map((k) => cfg.kindMinFee[k] ?? cfg.minFee);
  return fixed.length ? Math.min(...fixed) : cfg.minFee;
}

/** Lowest task price for a task starting at `atMs` (night adds the night extra, 22:00–07:00 local). */
export function minFeeAt(atMs: number, cfg: EngineConfig = DEFAULT_CONFIG): number {
  return isNight(atMs, cfg) ? cfg.minFee + cfg.nightFee : cfg.minFee;
}

const roundStep = (n: number, cfg: EngineConfig) => Math.round(n / cfg.feeStep) * cfg.feeStep;
const ceilStep = (n: number, cfg: EngineConfig) => Math.ceil(n / cfg.feeStep) * cfg.feeStep;
const floorStep = (n: number, cfg: EngineConfig) => Math.floor(n / cfg.feeStep) * cfg.feeStep;

/** What is actually held for items: the budget, plus the optional 10% buffer. */
export function heldItemBudget(budget: number, buffer: boolean, cfg: EngineConfig = DEFAULT_CONFIG): number {
  assertMoney(budget, "itemBudget");
  return buffer && budget > 0 ? budget + bps(budget, cfg.budgetBufferBps) : budget;
}

export interface QuoteLine {
  key: "base" | "time" | "distance" | "roundTrip" | "heavy" | "stairs" | "tools" | "night" | "secondPerson";
  amount: number;
  /** time: extra minutes · distance: extra km · stairs: floors carried. */
  qty?: number;
}

export interface Quote {
  /** Every part of the price, base first — shown to the customer line by line. */
  lines: QuoteLine[];
  /** The recommended price (≥ the minimum for that time of day). */
  total: number;
  /** 2 when the carry rule requires a second person. */
  peopleRequired: 1 | 2;
}

/**
 * Recommended price (docs/decisions.md 2026-11-15 "Pricing"): the base covers ~30 minutes within
 * 1 km; each extra is a visible line — more time, more distance, a round trip, a heavy item, stairs
 * without a lift, tools, night. A second person costs the labour part (base, time, heavy, stairs)
 * again; distance is shared. Works for any job, even one the app doesn't recognise, because it
 * only asks about effort.
 * Heavy + no lift (or unknown) + above the 2nd floor + the helper carries → two people required.
 */
export function quoteFee(category: CategoryId, d: ErrandDetails, cfg: EngineConfig = DEFAULT_CONFIG, atMs?: number): Quote {
  const lines: QuoteLine[] = [{ key: "base", amount: cfg.baseFee }];
  const minutes = Number.isFinite(d.minutes) && d.minutes > 0 ? d.minutes : cfg.includedMinutes;
  const extraMinutes = Math.max(0, minutes - cfg.includedMinutes);
  if (extraMinutes > 0) lines.push({ key: "time", amount: Math.ceil(extraMinutes / 30) * cfg.perHalfHour, qty: extraMinutes });
  if (d.heavy) lines.push({ key: "heavy", amount: cfg.heavyFee });
  const floor = d.floor ?? 1;
  const liftOk = d.lift === "yes";
  if (category === "carry" && d.carryByHelper && !liftOk && floor > 1) {
    lines.push({ key: "stairs", amount: cfg.carryPerFloor * (floor - 1), qty: floor - 1 });
  }
  const labour = lines.reduce((a, l) => a + l.amount, 0);

  const km = Number.isFinite(d.km) && d.km > 0 ? d.km : 0;
  const extraKm = Math.max(0, km - cfg.includedKm);
  const distance = roundStep(extraKm * cfg.perKm, cfg);
  if (distance > 0) lines.push({ key: "distance", amount: distance, qty: extraKm });
  if (d.roundTrip && km > 0) {
    // Return leg: the same distance again (roundTripBps, 100% by default), rounded to the fee step;
    // the included km only ever covers the way there.
    const back = roundStep(bps(km * cfg.perKm, cfg.roundTripBps), cfg);
    if (back > 0) lines.push({ key: "roundTrip", amount: back });
  }
  if (d.tools) lines.push({ key: "tools", amount: cfg.toolsFee });
  if (d.people === 2) lines.push({ key: "secondPerson", amount: labour });
  if (atMs !== undefined && isNight(atMs, cfg)) lines.push({ key: "night", amount: cfg.nightFee });

  const sum = lines.reduce((a, l) => a + l.amount, 0);
  // the suggestion never goes below this task's own minimum
  const total = Math.max(taskMinFee(category, d, atMs, cfg), roundStep(sum, cfg));
  const peopleRequired: 1 | 2 = category === "carry" && d.carryByHelper && d.heavy && !liftOk && floor > 2 ? 2 : 1;
  return { lines, total, peopleRequired };
}

/** What the customer may set: the recommended price −20%…+30% (never below the minimum). */
export function priceRange(recommended: number, atMs: number, cfg: EngineConfig = DEFAULT_CONFIG): { min: number; max: number } {
  const min = Math.max(minFeeAt(atMs, cfg), ceilStep(bps(recommended, 10_000 - cfg.priceDownBps), cfg));
  const max = Math.max(min, floorStep(bps(recommended, 10_000 + cfg.priceUpBps), cfg));
  return { min, max };
}

/** The highest counter-offer a helper may send on a task posted at `postedFee`. */
export function counterMaxFor(postedFee: number, cfg: EngineConfig = DEFAULT_CONFIG): number {
  return Math.max(postedFee, floorStep(bps(postedFee, 10_000 + cfg.counterUpBps), cfg));
}
