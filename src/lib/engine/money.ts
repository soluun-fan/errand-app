import { DEFAULT_CONFIG, categoryConfig, type CategoryId, type EngineConfig } from "./config";
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

export function buyerFeeFor(price: number, cfg: EngineConfig = DEFAULT_CONFIG): number {
  assertMoney(price, "price");
  return Math.max(cfg.buyerFeeMin, bps(price, cfg.buyerFeeBps));
}

/** What the payer must put into the hold. */
export function amountDue(deal: Deal): number {
  return deal.type === "errand"
    ? deal.itemBudget + deal.fee + deal.serviceFee
    : deal.price + deal.buyerFee;
}

/** True if `atMs` falls in the night window in local (Ulaanbaatar) time. */
export function isNight(atMs: number, cfg: EngineConfig = DEFAULT_CONFIG): boolean {
  const hour = Math.floor((atMs / 3_600_000 + cfg.utcOffsetHours) % 24 + 24) % 24;
  return cfg.nightStartHour > cfg.nightEndHour
    ? hour >= cfg.nightStartHour || hour < cfg.nightEndHour
    : hour >= cfg.nightStartHour && hour < cfg.nightEndHour;
}

/** Minimum helper fee for a task starting at `atMs` (night minimum applies 22:00–07:00 local). */
export function minFeeAt(atMs: number, cfg: EngineConfig = DEFAULT_CONFIG): number {
  return isNight(atMs, cfg) ? Math.max(cfg.minFee, cfg.nightMinFee) : cfg.minFee;
}

/** Suggested helper fee: category base + distance, rounded to the fee step, never below the minimum. */
export function suggestFee(
  category: CategoryId,
  km: number,
  cfg: EngineConfig = DEFAULT_CONFIG,
  atMs?: number,
): number {
  const distance = Number.isFinite(km) && km > 0 ? km : 0;
  const raw = categoryConfig(category).base + distance * cfg.perKm;
  const min = atMs === undefined ? cfg.minFee : minFeeAt(atMs, cfg);
  return Math.max(min, Math.round(raw / cfg.feeStep) * cfg.feeStep);
}

/** What is actually held for items: the budget, plus the optional 10% buffer. */
export function heldItemBudget(budget: number, buffer: boolean, cfg: EngineConfig = DEFAULT_CONFIG): number {
  assertMoney(budget, "itemBudget");
  return buffer && budget > 0 ? budget + bps(budget, cfg.budgetBufferBps) : budget;
}

export interface QuoteLine {
  key: "stairs" | "secondPerson" | "roundTrip";
  amount: number;
  /** stairs: floors carried. */
  qty?: number;
}

export interface Quote {
  /** Category base + distance (≥ the minimum for that time of day). */
  base: number;
  lines: QuoteLine[];
  /** The system price. Instant tasks may be raised above it, never lowered. */
  total: number;
  /** 2 when the carry rule requires a second person. */
  peopleRequired: 1 | 2;
}

/**
 * System price for an Instant task (docs/rules.md §Fees, §Eligibility).
 * Carry without a lift costs extra per floor above the first; a second person costs extra;
 * a round trip adds half the distance part.
 * Heavy + no lift (or unknown) + above the 2nd floor → two people are required.
 */
export function quoteFee(category: CategoryId, d: ErrandDetails, cfg: EngineConfig = DEFAULT_CONFIG, atMs?: number): Quote {
  const base = suggestFee(category, d.km, cfg, atMs);
  const lines: QuoteLine[] = [];
  const km = Number.isFinite(d.km) && d.km > 0 ? d.km : 0;
  if (d.roundTrip && km > 0) {
    // Return leg: a share of the distance part only, rounded to the fee step.
    const back = Math.round(bps(km * cfg.perKm, cfg.roundTripBps) / cfg.feeStep) * cfg.feeStep;
    if (back > 0) lines.push({ key: "roundTrip", amount: back });
  }
  const floor = d.floor ?? 1;
  const liftOk = d.lift === "yes";
  if (category === "carry" && d.carryByHelper && !liftOk && floor > 1) {
    lines.push({ key: "stairs", amount: cfg.carryPerFloor * (floor - 1), qty: floor - 1 });
  }
  if (d.people === 2) lines.push({ key: "secondPerson", amount: cfg.secondPersonFee });
  const peopleRequired: 1 | 2 = category === "carry" && d.carryByHelper && d.heavy && !liftOk && floor > 2 ? 2 : 1;
  return { base, lines, total: base + lines.reduce((a, l) => a + l.amount, 0), peopleRequired };
}
