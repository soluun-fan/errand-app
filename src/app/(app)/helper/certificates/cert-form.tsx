"use client";

import { useState } from "react";
import { CategoryIcon } from "@/components/category-icon";
import { DocUpload } from "@/components/doc-upload";
import { btn, chipClass, field, fieldLabel } from "@/components/ui";
import { useT } from "@/i18n/client";
import { categoryTrust, type CategoryId } from "@/lib/engine";
import { CERTIFIABLE } from "@/lib/org-rules";
import { prepareDoc, submitCert } from "../../orgs/actions";

/** A trade certificate (plumbing, electrical, cleaning) for working on your own; Ops checks it. */
export function CertForm() {
  const t = useT();
  const [category, setCategory] = useState<CategoryId>(CERTIFIABLE[0]);
  const [doc, setDoc] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(form: FormData) {
    setBusy(true);
    setError(null);
    const r = await submitCert({
      category,
      issuer: String(form.get("issuer") ?? ""),
      number: String(form.get("number") ?? ""),
      expiresOn: String(form.get("expiresOn") ?? ""),
      docPath: doc ?? "",
      firstAid: form.get("firstAid") === "on",
    });
    if (r.error) setError(r.error);
    else {
      setSent(true);
      setDoc(undefined);
    }
    setBusy(false);
  }

  return (
    <form action={submit} className="flex flex-col gap-4 rounded-card bg-bg p-4 shadow-card">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("cert.kind")}>
        {CERTIFIABLE.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={category === c} onClick={() => setCategory(c)} className={chipClass(category === c)}>
            <CategoryIcon id={c} size={15} /> {t(`categoryShort.${c}`)}
          </button>
        ))}
      </div>
      <label className={fieldLabel}>
        {t("cert.issuer")}
        <input name="issuer" required maxLength={120} className={field} placeholder={t("cert.issuerPh")} />
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className={fieldLabel}>
          {t("cert.number")}
          <input name="number" maxLength={60} className={field} />
        </label>
        <label className={fieldLabel}>
          {t("cert.expires")}
          <input name="expiresOn" type="date" className={field} />
        </label>
      </div>
      {categoryTrust(category) === "care" && (
        <label className="flex items-start gap-3 rounded-input bg-fill p-3 text-[15px]">
          <input type="checkbox" name="firstAid" className="mt-1 h-5 w-5" />
          <span>{t("care.firstAidClaim")}</span>
        </label>
      )}
      <DocUpload label={t("cert.doc")} path={doc} prepare={(mime, bytes) => prepareDoc("cert", mime, bytes)} onDone={setDoc} onError={setError} />
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {sent && <p className="text-sm text-held">{t("cert.sent")}</p>}
      <button disabled={busy || !doc} className={`${btn.primary} w-full`}>
        {busy ? t("common.working") : t("cert.submit")}
      </button>
    </form>
  );
}
