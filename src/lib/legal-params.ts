import "server-only";
import type { T } from "@/i18n";
import { fmtMoney } from "@/lib/format";
import { feeDescription } from "@/lib/fee-text";
import { getPricing } from "@/lib/pricing";
import { getRules } from "@/lib/rules";

/**
 * The live numbers the Terms and the Helper agreement quote — so the documents always say what the
 * app actually does (every amount is an Ops setting).
 */
export async function legalParams(t: T): Promise<Record<string, string | number>> {
  const [p, r] = await Promise.all([getPricing(), getRules()]);
  const tiers = feeDescription(p, t, "; ");
  return {
    tiers,
    minPrice: fmtMoney(p.baseFee),
    maxJob: fmtMoney(p.maxJobTotal),
    freeTasks: p.freeOpenTasks,
    extraFee: fmtMoney(p.extraTaskFee),
    tripFee: fmtMoney(p.cancelFee),
    payNow: r.paymentWindowMinutes,
    payBooked: r.paymentWindowBookedMinutes,
    checkHours: r.checkHours,
    grace: r.backOutGraceMinutes,
    pause1: r.pauseDaysFirst,
    pause2: r.pauseDaysSecond,
    pause3: r.pauseDaysMore,
    withdrawMin: fmtMoney(r.withdrawMin),
    perDay: r.withdrawalsPerDay,
    autoDays: r.autoPayoutDays,
    dayjobCap: r.dayjobPairMonthCap,
    routeDays: r.routeRetentionDays,
  };
}
