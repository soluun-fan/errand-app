"use client";

import { useActionState } from "react";
import { SubmitButton, type ActionResult } from "@/components/sheet";
import { btn, field, fieldLabel } from "@/components/ui";
import { useT } from "@/i18n/client";
import type { SupportSettings } from "@/lib/support";
import { closeSupportAction, saveSupportSettingsAction } from "../actions";

export function SupportSettingsForm({ s }: { s: SupportSettings }) {
  const t = useT();
  const [state, action] = useActionState<ActionResult, FormData>(saveSupportSettingsAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      {(["phone", "email", "facebook", "hours"] as const).map((k) => (
        <label key={k} className={fieldLabel} htmlFor={`support-${k}`}>
          {t(`opsSupport.f.${k}`)}
          <input id={`support-${k}`} name={k} defaultValue={s[k] ?? ""} className={field} inputMode={k === "phone" ? "tel" : k === "email" ? "email" : "text"} />
        </label>
      ))}
      <fieldset className="mt-2 flex flex-col gap-3">
        <legend className="text-body font-bold">{t("opsSupport.company")}</legend>
        <p className="text-meta text-ink-2">{t("opsSupport.companyHelp")}</p>
        {(["company_name", "company_reg_no", "company_address"] as const).map((k) => (
          <label key={k} className={fieldLabel} htmlFor={`support-${k}`}>
            {t(`opsSupport.f.${k}`)}
            <input id={`support-${k}`} name={k} defaultValue={s[k] ?? ""} maxLength={k === "company_address" ? 200 : k === "company_name" ? 120 : 40} className={field} />
          </label>
        ))}
      </fieldset>
      {state.error && <p role="alert" className="text-small text-danger">{state.error}</p>}
      {state.done && <p role="status" className="text-small text-held">{t("opsSupport.saved")}</p>}
      <SubmitButton className={btn.secondary}>{t("opsSupport.save")}</SubmitButton>
    </form>
  );
}

export function SupportDone({ id }: { id: string }) {
  const t = useT();
  const [state, action] = useActionState<ActionResult, FormData>(closeSupportAction, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <label className={fieldLabel} htmlFor={`note-${id}`}>
        {t("opsSupport.note")}
        <input id={`note-${id}`} name="note" maxLength={1000} className={field} />
      </label>
      {state.error && <p role="alert" className="text-small text-danger">{state.error}</p>}
      <SubmitButton className={btn.secondary}>{t("opsSupport.markDone")}</SubmitButton>
    </form>
  );
}
