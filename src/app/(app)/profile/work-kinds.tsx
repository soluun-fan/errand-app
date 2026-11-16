"use client";

import { useActionState } from "react";
import { CategoryIcon } from "@/components/category-icon";
import { SubmitButton, type ActionResult } from "@/components/sheet";
import { btn } from "@/components/ui";
import { useT } from "@/i18n/client";
import type { CategoryId } from "@/lib/engine";
import { setWorkKinds } from "./actions";

/** "Хийдэг ажил": the everyday kinds this helper takes (new ones can be added any time). */
export function WorkKinds({ all, mine }: { all: readonly CategoryId[]; mine: readonly CategoryId[] }) {
  const t = useT();
  const [state, action] = useActionState<ActionResult, FormData>(setWorkKinds, {});
  return (
    <form action={action} className="flex flex-col gap-3 rounded-card bg-bg p-4 shadow-card">
      <div className="flex flex-wrap gap-2">
        {all.map((c) => (
          <label key={c} className="flex min-h-10 items-center gap-1.5 rounded-full border border-line px-3 text-[14px] has-[:checked]:border-brand has-[:checked]:bg-brand-bg has-[:checked]:text-brand-ink">
            <input type="checkbox" name="kinds" value={c} defaultChecked={mine.includes(c)} className="sr-only" />
            <CategoryIcon id={c} size={14} /> {t(`categoryShort.${c}`)}
          </label>
        ))}
      </div>
      <p className="text-[13px] text-ink-2">{t("workKinds.help")}</p>
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      {state.done && <p className="text-sm text-held">{t("workKinds.saved")}</p>}
      <SubmitButton className={`${btn.secondary} w-full`}>{t("workKinds.save")}</SubmitButton>
    </form>
  );
}
