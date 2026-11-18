"use client";

import { useActionState } from "react";
import { SubmitButton, type ActionResult } from "@/components/sheet";
import { Note, btn, field, fieldLabel } from "@/components/ui";
import { useT } from "@/i18n/client";
import type { PricingSettings } from "@/lib/pricing";
import { savePricing } from "../actions";

/** The live price list (docs/decisions.md "Pricing"). New prices apply to tasks posted from now on. */
export function PricingForm({ p }: { p: PricingSettings }) {
  const t = useT();
  const [state, action] = useActionState<ActionResult, FormData>(savePricing, {});
  const num = (name: string, label: string, value: number, suffix = "₮") => (
    <label className={fieldLabel}>
      {label}
      <span className="flex items-center gap-2">
        <input name={name} inputMode="numeric" defaultValue={value} className={field} />
        <span className="w-6 text-ink-2">{suffix}</span>
      </span>
    </label>
  );
  return (
    <form action={action} className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="font-bold">{t("opsPricing.build")}</h2>
        <div className="grid grid-cols-2 gap-3">
          {num("baseFee", t("opsPricing.base"), p.baseFee)}
          {num("includedMinutes", t("opsPricing.includedMinutes"), p.includedMinutes, t("opsPricing.minSuffix"))}
          {num("includedKm", t("opsPricing.includedKm"), p.includedKm, "km")}
          {num("perHalfHour", t("opsPricing.perHalfHour"), p.perHalfHour)}
          {num("perKm", t("opsPricing.perKm"), p.perKm)}
          {num("heavyFee", t("price.line.heavy"), p.heavyFee)}
          {num("carryPerFloor", t("opsPricing.perFloor"), p.carryPerFloor)}
          {num("toolsFee", t("price.line.tools"), p.toolsFee)}
          {num("nightFee", t("price.line.night"), p.nightFee)}
          {num("roundTripPct", t("opsPricing.roundTrip"), p.roundTripBps / 100, "%")}
          {num("travelMinPerKm", t("opsPricing.travelMinPerKm"), p.travelMinPerKm, t("opsPricing.minSuffix"))}
          {num("cancelFee", t("opsPricing.cancelFee"), p.cancelFee)}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-bold">{t("opsPricing.freedom")}</h2>
        <div className="grid grid-cols-3 gap-3">
          {num("priceDownPct", t("opsPricing.down"), p.priceDownBps / 100, "%")}
          {num("priceUpPct", t("opsPricing.up"), p.priceUpBps / 100, "%")}
          {num("counterUpPct", t("opsPricing.counter"), p.counterUpBps / 100, "%")}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-bold">{t("opsPricing.serviceFee")}</h2>
        <p className="text-sm text-ink-2">{t("opsPricing.serviceFeeHelp")}</p>
        <input type="hidden" name="tierCount" value={p.serviceFeeTiers.length} />
        {p.serviceFeeTiers.map((tier, i) => (
          <div key={i} className="grid grid-cols-2 gap-3">
            {tier.below !== null ? (
              num(`tierBelow${i}`, t("opsPricing.tierBelow"), tier.below)
            ) : (
              <p className="self-end pb-4 text-[15px] text-ink-2">{t("opsPricing.tierRest")}</p>
            )}
            {num(`tierFee${i}`, t("opsPricing.tierFee"), tier.fee)}
          </div>
        ))}
      </section>

      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      {state.done && <Note tone="held">{t("opsPricing.saved")}</Note>}
      <SubmitButton className={`${btn.primary} w-full`}>{t("opsSafety.save")}</SubmitButton>
    </form>
  );
}
