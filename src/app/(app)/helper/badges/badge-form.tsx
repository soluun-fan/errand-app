"use client";

import { useActionState, useState } from "react";
import { DocUpload } from "@/components/doc-upload";
import { SubmitButton, type ActionResult } from "@/components/sheet";
import { field, fieldLabel } from "@/components/ui";
import { useT } from "@/i18n/client";
import { prepareDoc } from "../../orgs/actions";
import { requestBadgeAction } from "./actions";

/** Send a driver's licence or car registration for Ops to check. */
export function BadgeForm({ kind }: { kind: "driver" | "car" }) {
  const t = useT();
  const [state, action] = useActionState<ActionResult, FormData>(requestBadgeAction, {});
  const [doc, setDoc] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  if (state.done) return <p className="rounded-input bg-held-bg p-3 text-sm text-held">{t("badges.sent")}</p>;
  return (
    <form action={action} className="flex flex-col gap-3 rounded-card bg-bg p-4 shadow-card">
      <h2 className="font-bold">{kind === "driver" ? `🚗 ${t("badges.driverTitle")}` : `🚙 ${t("badges.carTitle")}`}</h2>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="docPath" value={doc ?? ""} />
      {kind === "driver" ? (
        <div className="grid grid-cols-2 gap-3">
          <label className={fieldLabel}>
            {t("badges.number")}
            <input name="number" required maxLength={30} className={field} />
          </label>
          <label className={fieldLabel}>
            {t("badges.classes")}
            <input name="classes" required maxLength={20} placeholder="B" className={field} />
          </label>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <label className={fieldLabel}>
            {t("badges.plate")}
            <input name="plate" required maxLength={10} placeholder="1234 УБА" className={field} />
          </label>
          <label className={fieldLabel}>
            {t("badges.type")}
            <select name="type" className={field} defaultValue="sedan">
              {(["sedan", "suv", "van", "truck", "other"] as const).map((x) => (
                <option key={x} value={x}>
                  {t(`badges.types.${x}`)}
                </option>
              ))}
            </select>
          </label>
          <label className={`${fieldLabel} col-span-2`}>
            {t("badges.model")}
            <input name="model" required maxLength={60} placeholder="Toyota Prius" className={field} />
          </label>
        </div>
      )}
      <label className={fieldLabel}>
        {t("badges.expires")}
        <input name="expiresOn" type="date" className={field} />
      </label>
      <DocUpload label={kind === "driver" ? t("badges.docDriver") : t("badges.docCar")} path={doc} prepare={(mime, bytes) => prepareDoc("cert", mime, bytes)} onDone={setDoc} onError={setError} />
      {(error || state.error) && (
        <p role="alert" className="text-sm text-danger">
          {error ?? state.error}
        </p>
      )}
      <SubmitButton className="min-h-12 rounded-input bg-ink px-4 font-bold text-white disabled:bg-fill">{t("badges.submit")}</SubmitButton>
    </form>
  );
}
