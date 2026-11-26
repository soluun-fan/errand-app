"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CategoryIcon } from "@/components/category-icon";
import type { ActionResult } from "@/components/sheet";
import { btn, field, fieldLabel } from "@/components/ui";
import { useT } from "@/i18n/client";
import type { CategoryId } from "@/lib/engine";
import { decideOrgAction } from "../../actions";

/** Approve for some of the requested kinds, reject, or suspend (a note is required unless approving). */
export function DecideOrg({ id, requested, approved }: { id: string; requested: CategoryId[]; approved: CategoryId[] }) {
  const t = useT();
  const [state, action] = useActionState<ActionResult, FormData>(decideOrgAction, {});
  return (
    <form action={action} className="flex flex-col gap-3 rounded-card bg-bg p-4 shadow-card">
      <input type="hidden" name="id" value={id} />
      <fieldset className="flex flex-wrap gap-2">
        <legend className="mb-2 text-small font-semibold">{t("opsOrgs.approveFor")}</legend>
        {requested.map((c) => (
          <label key={c} className="flex min-h-10 items-center gap-1.5 rounded-full border border-line px-3 text-small has-[:checked]:border-brand has-[:checked]:bg-brand-bg">
            <input type="checkbox" name="categories" value={c} defaultChecked={approved.length ? approved.includes(c) : true} className="accent-brand" />
            <CategoryIcon id={c} size={14} /> {t(`categoryShort.${c}`)}
          </label>
        ))}
      </fieldset>
      <label className={fieldLabel}>
        {t("opsOrgs.note")}
        <textarea name="note" maxLength={500} rows={3} className={`${field} min-h-20 py-2`} />
      </label>
      {state.error && (
        <p role="alert" className="text-small text-danger">
          {state.error}
        </p>
      )}
      {state.done && <p className="text-small text-held">{t("opsContent.saved")}</p>}
      <Choices />
    </form>
  );
}

/** The three decisions; the clicked button's value is what is sent. Disabled while sending. */
function Choices() {
  const t = useT();
  const { pending } = useFormStatus();
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <button name="status" value="approved" disabled={pending} className={`${btn.primary} w-full`}>
        {t("opsOrgs.approve")}
      </button>
      <button name="status" value="rejected" disabled={pending} className={`${btn.secondary} w-full`}>
        {t("opsOrgs.reject")}
      </button>
      <button name="status" value="suspended" disabled={pending} className={`${btn.secondary} w-full text-danger`}>
        {t("opsOrgs.suspend")}
      </button>
    </div>
  );
}
