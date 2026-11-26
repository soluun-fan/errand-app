"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/sheet";
import { CategoryIcon } from "@/components/category-icon";
import { Note, btn, chipClass } from "@/components/ui";
import { useT } from "@/i18n/client";
import { CATEGORIES } from "@/lib/engine/config";
import { activateTestHelper, type TestHelperState } from "./actions";

const initial: TestHelperState = {};

export function TestHelperForm({ allowed }: { allowed: boolean }) {
  const t = useT();
  const [state, action] = useActionState(activateTestHelper, initial);
  if (!allowed) return <Note tone="warn">{t("kyc.testInviteOnly")}</Note>;

  return (
    <form action={action} className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-body font-medium text-ink-2">{t("kyc.categories")}</legend>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.filter((category) => category.trust === "open").map((category) => (
            <label key={category.id} className={chipClass(false)}>
              <input className="accent-ink" type="checkbox" name="categories" value={category.id} />
              <CategoryIcon id={category.id} size={16} />
              {t(`categoryShort.${category.id}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex items-start gap-3 text-body">
        <input className="mt-1 h-5 w-5 flex-none accent-ink" type="checkbox" name="agreement" required />
        <span>
          {t("kyc.agreement")}{" "}
          <a href="/helper-terms" target="_blank" className="font-semibold text-brand-ink underline underline-offset-2">
            {t("kyc.agreementLink")}
          </a>
        </span>
      </label>
      {state.error && (
        <p role="alert" className="text-small text-danger">
          {state.error}
        </p>
      )}
      <SubmitButton className={`${btn.primary} w-full`} pendingLabel={t("common.working")}>
        {t("kyc.testActivate")}
      </SubmitButton>
    </form>
  );
}
