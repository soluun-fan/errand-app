"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { SubmitButton } from "@/components/sheet";
import { Note, btn, field, fieldLabel } from "@/components/ui";
import { useT } from "@/i18n/client";
import { formatMnPhone } from "@/lib/phone";
import type { LoginChallengeView } from "@/lib/verify-mn-login";
import { login, type LoginState } from "./actions";

const initial: LoginState = { step: "phone" };

export function LoginForm({ showDemoHint, verifyMn, pending, next = "/" }: { showDemoHint: boolean; verifyMn: boolean; pending: LoginChallengeView | null; next?: string }) {
  const t = useT();
  const [state, action, busy] = useActionState<LoginState, FormData>(login, pending ? { step: "verify-mn", view: pending } : initial);
  const checkForm = useRef<HTMLFormElement>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (state.step !== "verify-mn") return;
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    const poll = window.setInterval(() => {
      if (!busy && document.visibilityState === "visible") checkForm.current?.requestSubmit();
    }, 3000);
    return () => { window.clearInterval(clock); window.clearInterval(poll); };
  }, [busy, state]);

  if (state.step === "verify-mn") {
    const expired = now >= Date.parse(state.view.expiresAt);
    return (
      <form action={action} ref={checkForm} className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />
        {expired ? <Note tone="warn">{t("verifyRecipient.expired")}</Note> : <>
          <p>{state.view.displayInstruction}</p>
          <a href={state.view.smsUri} className={btn.primary}>{t("verifyRecipient.openSms")}</a>
          <p role="status" className="text-sm text-ink-2">{t("verifyRecipient.waiting")}</p>
        </>}
        {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
        <button type="submit" disabled={busy} className={btn.secondary}>{t("login.checkStatus")}</button>
        <button name="intent" value="change-number" className={btn.text}>{t("login.otherNumber")}</button>
      </form>
    );
  }

  if (state.step === "code") {
    return (
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />
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
      <input type="hidden" name="next" value={next} />
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
      <SubmitButton className={`${btn.primary} w-full`} pendingLabel={t(verifyMn ? "login.checking" : "login.sending")}>
        {t(verifyMn ? "verifyRecipient.start" : "login.send")}
      </SubmitButton>
      {showDemoHint && <Note tone="warn">{t("login.devHint")}</Note>}
    </form>
  );
}
