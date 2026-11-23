import type { T } from "@/i18n";
import type { FeeTier } from "@/lib/engine";
import { fmtMoney } from "@/lib/format";

/**
 * The service fee in words, from the live settings — for Help and the Terms, so the documents always
 * say what the app charges. A share with a floor and cap (2026-11-22), or the older flat steps.
 */
export function feeDescription(p: { serviceFeeBps: number; serviceFeeMin: number; serviceFeeMax: number; serviceFeeTiers: readonly FeeTier[] }, t: T, sep = " · "): string {
  if (p.serviceFeeBps > 0) {
    return t("help.feeShare", { pct: p.serviceFeeBps / 100, min: fmtMoney(p.serviceFeeMin), max: fmtMoney(p.serviceFeeMax) });
  }
  return p.serviceFeeTiers
    .map((x, i, all) =>
      x.below !== null
        ? t("help.tier", { fee: fmtMoney(x.fee), below: fmtMoney(x.below) })
        : t("help.tierLast", { fee: fmtMoney(x.fee), from: fmtMoney(all[i - 1]?.below ?? 0) }),
    )
    .join(sep);
}
