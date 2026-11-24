"use client";

import { useActionState } from "react";
import { SubmitButton, type ActionResult } from "@/components/sheet";
import { chipClass } from "@/components/ui";
import { useT } from "@/i18n/client";
import { LANGUAGES } from "@/lib/engine/types";
import { saveLanguagesAction } from "./actions";
import { Globe } from "lucide-react";
import { Ico } from "@/components/icon";

/** Languages the helper speaks besides Mongolian (self-declared; customers can ask for one). */
export function LanguagesForm({ current }: { current: readonly string[] }) {
  const t = useT();
  const [state, action] = useActionState<ActionResult, FormData>(saveLanguagesAction, {});
  return (
    <form action={action} className="flex flex-col gap-3 rounded-card bg-bg p-4 shadow-card">
      <h2 className="font-bold"><Ico as={Globe} /> {t("badges.languagesTitle")}</h2>
      <p className="text-sm text-ink-2">{t("badges.languagesSub")}</p>
      <div className="flex flex-wrap gap-2">
        {LANGUAGES.map((l) => (
          <label key={l} className="cursor-pointer">
            <input type="checkbox" name="languages" value={l} defaultChecked={current.includes(l)} className="peer sr-only" />
            <span className={`${chipClass(false)} peer-checked:bg-ink peer-checked:text-white peer-focus-visible:ring-2`}>{t(`conditions.lang.${l}`)}</span>
          </label>
        ))}
      </div>
      {state.done && <p className="text-sm text-held">{t("badges.saved")}</p>}
      <SubmitButton className="min-h-11 self-start rounded-full bg-ink px-5 text-[15px] font-bold text-white">{t("badges.save")}</SubmitButton>
    </form>
  );
}
