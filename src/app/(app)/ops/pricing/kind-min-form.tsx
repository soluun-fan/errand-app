"use client";

import { useActionState, useState } from "react";
import { CategoryIcon } from "@/components/category-icon";
import type { ActionResult } from "@/components/sheet";
import { SubmitButton } from "@/components/sheet";
import { field } from "@/components/ui";
import { useT } from "@/i18n/client";
import type { CategoryId } from "@/lib/engine";
import { saveKindMinimum } from "../actions";

type Mode = "general" | "fixed" | "hourly";

/** One kind's lowest price: the general minimum, its own fixed minimum, or an hourly floor × hours. */
export function KindMinForm({
  category,
  minFee,
  minHourly,
  general,
  defaultMinutes,
  checkHours,
}: {
  category: CategoryId;
  minFee: number | null;
  minHourly: number | null;
  general: number;
  defaultMinutes: number;
  checkHours: number | null;
}) {
  const t = useT();
  const [state, action] = useActionState<ActionResult, FormData>(saveKindMinimum, {});
  const [mode, setMode] = useState<Mode>(minHourly !== null ? "hourly" : minFee !== null ? "fixed" : "general");
  return (
    <form action={action} className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 last:border-b-0">
      <input type="hidden" name="category" value={category} />
      <span className="flex min-w-32 flex-1 items-center gap-2 font-semibold">
        <CategoryIcon id={category} size={16} /> {t(`categoryShort.${category}`)}
      </span>
      <select
        name="mode"
        value={mode}
        onChange={(e) => setMode(e.target.value as Mode)}
        className={`${field} w-auto min-w-36`}
        aria-label={t("opsPricing.kindMode")}
      >
        <option value="general">{t("opsPricing.kindGeneral", { amount: general.toLocaleString("en-US") })}</option>
        <option value="fixed">{t("opsPricing.kindFixed")}</option>
        <option value="hourly">{t("opsPricing.kindHourly")}</option>
      </select>
      {mode !== "general" && (
        <input
          name="amount"
          inputMode="numeric"
          defaultValue={(mode === "hourly" ? minHourly : minFee) ?? ""}
          className={`${field} w-28 tabular-nums`}
          aria-label={mode === "hourly" ? t("opsPricing.kindHourly") : t("opsPricing.kindFixed")}
        />
      )}
      <label className="flex flex-col gap-1 text-sm">
        {t("opsPricing.defaultMinutes")}
        <input
          type="number"
          name="defaultMinutes"
          required
          min={30}
          max={480}
          step={30}
          defaultValue={defaultMinutes}
          className={`${field} w-28 tabular-nums`}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t("opsPricing.checkHours")}
        <input
          type="number"
          name="checkHours"
          min={2}
          max={168}
          defaultValue={checkHours ?? ""}
          placeholder={t("opsPricing.useGeneral")}
          className={`${field} w-32 tabular-nums`}
        />
      </label>
      <SubmitButton className="min-h-10 rounded-full bg-ink px-4 text-[14px] font-bold text-white">{t("opsPricing.save")}</SubmitButton>
      {state.error && <span className="w-full text-[12px] text-danger">{state.error}</span>}
      {state.done && <span className="w-full text-[12px] text-held">{t("opsPricing.saved")}</span>}
    </form>
  );
}
