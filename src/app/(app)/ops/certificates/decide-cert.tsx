"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionResult } from "@/components/sheet";
import { btn, field } from "@/components/ui";
import { useT } from "@/i18n/client";
import { decideCertAction } from "../actions";

export function DecideCert({ id }: { id: string }) {
  const t = useT();
  const [state, action] = useActionState<ActionResult, FormData>(decideCertAction, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <input name="note" maxLength={500} placeholder={t("opsOrgs.note")} className={field} />
      {state.error && <p className="text-sm text-danger">{state.error}</p>}
      <Buttons />
    </form>
  );
}
function Buttons() {
  const t = useT();
  const { pending } = useFormStatus();
  return (
    <div className="grid grid-cols-2 gap-2">
      <button name="approve" value="1" disabled={pending} className={`${btn.primary} w-full`}>
        {t("opsOrgs.approve")}
      </button>
      <button name="approve" value="0" disabled={pending} className={`${btn.secondary} w-full`}>
        {t("opsOrgs.reject")}
      </button>
    </div>
  );
}
