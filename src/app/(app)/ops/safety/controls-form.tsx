"use client";

import { useActionState } from "react";
import { SubmitButton, type ActionResult } from "@/components/sheet";
import { Note, btn, field, fieldLabel } from "@/components/ui";
import { useT } from "@/i18n/client";
import type { Controls } from "@/lib/safety";
import { saveControls } from "../actions";

/** Pause switches + caps. A pause needs a short note (it's shown in the audit log). */
export function ControlsForm({ c }: { c: Omit<Controls, "updatedAt"> }) {
  const t = useT();
  const [state, action] = useActionState<ActionResult, FormData>(saveControls, {});
  const num = (name: string, label: string, value: number, help: string) => (
    <label className={fieldLabel}>
      {label}
      <input name={name} inputMode="numeric" defaultValue={value} className={field} />
      <span className="text-small font-normal">{help}</span>
    </label>
  );
  return (
    <form action={action} className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="font-bold">{t("opsSafety.switches")}</h2>
        <label className="flex items-start gap-3 text-body">
          <input type="checkbox" name="postingPaused" defaultChecked={c.postingPaused} className="mt-1 h-5 w-5 flex-none accent-danger" />
          <span>
            <span className="block font-semibold">{t("opsSafety.pausePosting")}</span>
            <span className="block text-ink-2">{t("opsSafety.pausePostingHelp")}</span>
          </span>
        </label>
        <label className="flex items-start gap-3 text-body">
          <input type="checkbox" name="paymentsPaused" defaultChecked={c.paymentsPaused} className="mt-1 h-5 w-5 flex-none accent-danger" />
          <span>
            <span className="block font-semibold">{t("opsSafety.freeze")}</span>
            <span className="block text-ink-2">{t("opsSafety.freezeHelp")}</span>
          </span>
        </label>
        <label className={fieldLabel}>
          {t("opsSafety.note")}
          <input name="pauseNote" maxLength={300} defaultValue={c.pauseNote ?? ""} className={field} />
        </label>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-bold">{t("opsSafety.caps")}</h2>
        {num("maxDealAmount", t("opsSafety.capDeal"), c.maxDealAmount, t("opsSafety.capDealHelp"))}
        {num("maxCustomerDaily", t("opsSafety.capDaily"), c.maxCustomerDaily, t("opsSafety.capDailyHelp"))}
        {num("maxTotalHeld", t("opsSafety.capTotal"), c.maxTotalHeld, t("opsSafety.capTotalHelp"))}
        {num("maxOpenTasks", t("opsSafety.capOpen"), c.maxOpenTasks, t("opsSafety.capOpenHelp"))}
      </section>

      {state.error && (
        <p role="alert" className="text-small text-danger">
          {state.error}
        </p>
      )}
      {state.done && <Note tone="held">{t("opsSafety.saved")}</Note>}
      <SubmitButton className={`${btn.primary} w-full`}>{t("opsSafety.save")}</SubmitButton>
    </form>
  );
}
