"use client";

import { useActionState } from "react";
import { SubmitButton, type ActionResult } from "@/components/sheet";
import { Note, btn, field, fieldLabel } from "@/components/ui";
import { useT } from "@/i18n/client";
import { SUPPORT_MAX, SUPPORT_MIN, SUPPORT_TOPICS } from "@/lib/support-rules";
import { sendSupport } from "./actions";

export function SupportForm() {
  const t = useT();
  const [state, action] = useActionState<ActionResult, FormData>(sendSupport, {});
  if (state.done) return <Note tone="held">{t("support.sent")}</Note>;
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className={fieldLabel} htmlFor="support-topic">
        {t("support.topic")}
        <select id="support-topic" name="topic" defaultValue="payment" className={field}>
          {SUPPORT_TOPICS.map((k) => <option key={k} value={k}>{t(`support.topics.${k}`)}</option>)}
        </select>
      </label>
      <label className={fieldLabel} htmlFor="support-message">
        {t("support.message")}
        <textarea id="support-message" name="message" required minLength={SUPPORT_MIN} maxLength={SUPPORT_MAX} rows={5} className={field} placeholder={t("support.placeholder")} />
      </label>
      {state.error && <p role="alert" className="text-small text-danger">{state.error}</p>}
      <SubmitButton className={`${btn.primary} w-full`}>{t("support.send")}</SubmitButton>
    </form>
  );
}
