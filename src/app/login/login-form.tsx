"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/sheet";
import { Note, btn, field, fieldLabel } from "@/components/ui";
import { useT } from "@/i18n/client";
import { formatMnPhone } from "@/lib/phone";
import { login, type LoginState } from "./actions";

const initial: LoginState = { step: "phone" };

export function LoginForm({ showDemoHint }: { showDemoHint: boolean }) {
  const t = useT();
  const [state, action] = useActionState(login, initial);

  if (state.step === "code") {
    return (
      <form action={action} className="flex flex-col gap-4">
        <p className="text-[15px] text-ink-2">{t("login.sentTo", { phone: formatMnPhone(state.phone) })}</p>
        {state.devCode && (
          <Note tone="warn">
            {t("login.devCode", { code: "" })}
            <b className="font-mono text-base tracking-widest">{state.devCode}</b>
          </Note>
        )}
        <label className={fieldLabel}>
          {t("login.code")}
          <input
            name="code"
            className={`${field} text-center text-2xl tracking-[0.4em]`}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            autoFocus
          />
        </label>
        {state.error && (
          <p role="alert" className="text-sm text-danger">
            {state.error}
          </p>
        )}
        <SubmitButton className={`${btn.primary} w-full`} pendingLabel={t("login.checking")}>
          {t("login.signIn")}
        </SubmitButton>
        <button name="intent" value="change-number" formNoValidate className={`${btn.text} w-full`}>
          {t("login.otherNumber")}
        </button>
      </form>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <label className={fieldLabel}>
        {t("login.phone")}
        <div className="flex items-center gap-2">
          <span className="text-base font-normal text-ink-2">+976</span>
          <input
            name="phone"
            className={field}
            inputMode="tel"
            autoComplete="tel-national"
            placeholder="8800 0001"
            defaultValue={state.phoneInput}
            required
            autoFocus
          />
        </div>
      </label>
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      <SubmitButton className={`${btn.primary} w-full`} pendingLabel={t("login.sending")}>
        {t("login.send")}
      </SubmitButton>
      {showDemoHint && <Note tone="warn">{t("login.devHint")}</Note>}
    </form>
  );
}
