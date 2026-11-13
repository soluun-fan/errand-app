import { DEFAULT_CONFIG, categoryConfig, type CategoryId, type EngineConfig } from "./config";
import { assertMoney } from "./errors";
import type { Deal } from "./types";

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

/** Suggested helper fee: category base + distance, rounded to the fee step, never below the minimum. */
export function suggestFee(category: CategoryId, km: number, cfg: EngineConfig = DEFAULT_CONFIG): number {
  const distance = Number.isFinite(km) && km > 0 ? km : 0;
  const raw = categoryConfig(category).base + distance * cfg.perKm;
  return Math.max(cfg.minFee, Math.round(raw / cfg.feeStep) * cfg.feeStep);
}
