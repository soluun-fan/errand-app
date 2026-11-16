"use client";

import { useState } from "react";
import { CategoryIcon } from "@/components/category-icon";
import { DocUpload } from "@/components/doc-upload";
import { Note, btn, chipClass, field, fieldLabel } from "@/components/ui";
import { useT } from "@/i18n/client";
import { categoryTrust, type CategoryId } from "@/lib/engine";
import { BANKS } from "@/lib/kyc-rules";
import { ORG_KINDS, SPECIALIZED, type OrgKind } from "@/lib/org-rules";
import { applyOrg, prepareDoc } from "../actions";

/** Register an organisation (company, agency, NGO). Ops checks the registration certificate and approves it for some kinds of work. */
export function OrgForm() {
  const t = useT();
  const [kind, setKind] = useState<OrgKind>("company");
  const [kinds, setKinds] = useState<CategoryId[]>([]);
  const [doc, setDoc] = useState<string>();
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toggle = (c: CategoryId) => setKinds((k) => (k.includes(c) ? k.filter((x) => x !== c) : [...k, c]));

  async function submit(form: FormData) {
    setBusy(true);
    setError(null);
    const r = await applyOrg({
      name: String(form.get("name") ?? ""),
      regNumber: String(form.get("regNumber") ?? ""),
      kind,
      description: String(form.get("description") ?? ""),
      area: String(form.get("area") ?? ""),
      categories: kinds,
      docPath: doc ?? "",
      bank: String(form.get("bank") ?? ""),
      accountNumber: String(form.get("accountNumber") ?? ""),
      holderName: String(form.get("holderName") ?? ""),
      consent,
    });
    if (r?.error) setError(r.error);
    setBusy(false);
  }

  return (
    <form action={submit} className="flex flex-col gap-4">
      <label className={fieldLabel}>
        {t("org.name")}
        <input name="name" required maxLength={80} className={field} placeholder={t("org.namePh")} />
      </label>
      <label className={fieldLabel}>
        {t("org.regNumber")}
        <input name="regNumber" required inputMode="numeric" pattern="[0-9]{7}" maxLength={7} className={`${field} tabular-nums`} placeholder="1234567" />
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-[15px] font-medium text-ink-2">{t("org.kind")}</legend>
        <div className="flex flex-wrap gap-2">
          {ORG_KINDS.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => { setKind(k); if (k !== "agency") setKinds((cs) => cs.filter((c) => categoryTrust(c) !== "care")); }} className={chipClass(kind === k)}>
              {t(`org.kinds.${k}`)}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-[15px] font-medium text-ink-2">{t("org.categories")}</legend>
        <div className="flex flex-wrap gap-2">
          {SPECIALIZED.filter((c) => kind === "agency" || categoryTrust(c) !== "care").map((c) => (
            <button key={c} type="button" role="checkbox" aria-checked={kinds.includes(c)} onClick={() => toggle(c)} className={chipClass(kinds.includes(c))}>
              <CategoryIcon id={c} size={15} /> {t(`categoryShort.${c}`)}
            </button>
          ))}
        </div>
        {kinds.some((c) => c === "childcare" || c === "eldercare") && <Note tone="warn">{t("org.careNote")}</Note>}
      </fieldset>
      <label className={fieldLabel}>
        {t("org.description")}
        <textarea name="description" maxLength={1000} rows={4} className={`${field} min-h-28 py-3`} placeholder={t("org.descriptionPh")} />
      </label>
      <label className={fieldLabel}>
        {t("org.area")}
        <input name="area" maxLength={80} className={field} placeholder={t("org.areaPh")} />
      </label>
      <DocUpload label={t("org.doc")} help={t("org.docHelp")} path={doc} prepare={(mime, bytes) => prepareDoc("org", mime, bytes)} onDone={setDoc} onError={setError} />

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-[15px] font-medium text-ink-2">{t("org.payout")}</legend>
        <label className={fieldLabel}>
          {t("kyc.bank")}
          <select name="bank" required className={field} defaultValue="">
            <option value="" disabled>
              —
            </option>
            {BANKS.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </label>
        <label className={fieldLabel}>
          {t("kyc.account")}
          <input name="accountNumber" required inputMode="numeric" className={`${field} tabular-nums`} />
        </label>
        <label className={fieldLabel}>
          {t("org.holder")}
          <input name="holderName" required maxLength={120} className={field} />
        </label>
      </fieldset>

      <label className="flex items-start gap-3 text-[14px]">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-5 w-5 accent-brand" />
        <span>{t("org.consent")}</span>
      </label>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <button disabled={busy || !doc || !consent || kinds.length === 0} className={`${btn.primary} w-full`}>
        {busy ? t("common.working") : t("org.submit")}
      </button>
    </form>
  );
}
