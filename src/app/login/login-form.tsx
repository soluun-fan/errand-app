"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/sheet";
import { Note, btn, field, fieldLabel } from "@/components/ui";
import { useT } from "@/i18n/client";
import { formatMnPhone } from "@/lib/phone";
import { browserClient } from "@/lib/supabase/browser";
import { login, type LoginState } from "./actions";

const initial: LoginState = { step: "phone" };

export function LoginForm({
  showDemoHint,
  googleEnabled,
  googleError: initialGoogleError,
  next = "/",
}: {
  showDemoHint: boolean;
  googleEnabled: boolean;
  googleError?: "notAllowed" | "failed";
  next?: string;
}) {
  const t = useT();
  const [state, action] = useActionState(login, initial);
  const [googlePending, setGooglePending] = useState(false);
  const [googleError, setGoogleError] = useState(
    initialGoogleError ? t(initialGoogleError === "notAllowed" ? "login.googleNotAllowed" : "login.googleFailed") : "",
  );

  async function signInWithGoogle() {
    setGooglePending(true);
    setGoogleError("");
    const redirectTo = new URL(`/auth/callback?next=${encodeURIComponent(next)}`, window.location.origin).toString();
    const { error } = await browserClient().auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
    if (error) {
      setGoogleError(t("login.googleFailed"));
      setGooglePending(false);
    }
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
    <div className="flex flex-col gap-4">
      {googleEnabled && (
        <>
          <button type="button" disabled={googlePending} onClick={signInWithGoogle} className={`${btn.secondary} w-full`}>
            <span aria-hidden className="mr-2 font-bold">G</span>
            {googlePending ? t("login.googleStarting") : t("login.google")}
          </button>
          {googleError && <p role="alert" className="text-sm text-danger">{googleError}</p>}
          <p className="text-center text-sm text-ink-2">{t("login.orPhone")}</p>
        </>
      )}
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
        <SubmitButton className={`${btn.primary} w-full`} pendingLabel={t("login.sending")}>
          {t("login.send")}
        </SubmitButton>
        {showDemoHint && <Note tone="warn">{t("login.devHint")}</Note>}
      </form>
    </div>
  );
}
