"use client";

import Link from "next/link";
import { startTransition, useActionState, useState, type FormEvent } from "react";
import { btn, field, fieldLabel } from "@/components/ui";
import { useT } from "@/i18n/client";
import { completeOnboarding, type OnboardingResult } from "./actions";

export function OnboardingForm({ next, missing, name }: { next: string; missing: ("name" | "age" | "terms" | "privacy")[]; name: string }) {
  const t = useT();
  const [state, action, pending] = useActionState<OnboardingResult, FormData>(completeOnboarding, {});
  // kept in state: a refused attempt (e.g. under 18) must not wipe what was entered
  const [nameV, setNameV] = useState(name);
  const [ticks, setTicks] = useState({ age: false, terms: false, privacy: false });
  const check = (n: "age" | "terms" | "privacy", label: string, href?: string, linkText?: string) => (
    <label className="flex items-start gap-3 rounded-input bg-bg p-3 text-[15px] shadow-card">
      <input type="checkbox" name={n} required checked={ticks[n]} onChange={(e) => setTicks({ ...ticks, [n]: e.target.checked })} className="mt-1 h-5 w-5 flex-none accent-ink" />
      <span>
        {label}{" "}
        {href && linkText && (
          <Link href={href} target="_blank" className="font-semibold text-brand-ink underline underline-offset-2">
            {linkText}
          </Link>
        )}
      </span>
    </label>
  );
  return (
    <form
      // sent by hand: React clears a form after an action, which would wipe the entries on an error
      onSubmit={(e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="next" value={next} />
      {missing.includes("name") && (
        <label className={fieldLabel}>
          {t("onboarding.name")}
          <input name="name" required minLength={2} maxLength={40} value={nameV} onChange={(e) => setNameV(e.target.value)} autoComplete="name" placeholder={t("onboarding.namePh")} className={field} />
          <span className="text-[12px] font-normal text-ink-2">{t("onboarding.nameHelp")}</span>
        </label>
      )}
      {missing.includes("age") && check("age", t("onboarding.ageLabel"))}
      {missing.includes("terms") && check("terms", t("onboarding.termsLabel"), "/terms", t("onboarding.termsLink"))}
      {missing.includes("privacy") && check("privacy", t("onboarding.privacyLabel"), "/privacy", t("onboarding.privacyLink"))}
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} aria-busy={pending} className={`${btn.primary} w-full`}>
        {pending ? t("common.working") : t("onboarding.go")}
      </button>
    </form>
  );
}
