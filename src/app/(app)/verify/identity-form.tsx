"use client";

import { useState } from "react";
import { btn, field, fieldLabel } from "@/components/ui";
import { useT } from "@/i18n/client";
import { KYC_DOCS, type KycDoc } from "@/lib/kyc-rules";
import { DocSlot } from "../helper/apply/apply-form";
import { submitIdentityCheck } from "./actions";

/** A customer's ID check: name and birth date as on the ID, its last 4 digits, the two sides and a selfie. */
export function IdentityForm() {
  const t = useT();
  const [legalName, setLegalName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [idLast4, setIdLast4] = useState("");
  const [files, setFiles] = useState<Partial<Record<KycDoc, string>>>({});
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await submitIdentityCheck({ legalName, birthDate, idLast4, files, consent });
      if (r?.error) setError(r.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <label className={fieldLabel}>
        {t("kyc.legalName")}
        <input className={field} value={legalName} maxLength={80} autoComplete="name" placeholder="Батболдын Тэмүүжин" lang="mn" onChange={(e) => setLegalName(e.target.value)} />
      </label>
      <label className={fieldLabel}>
        {t("kyc.birthDate")}
        <input className={field} type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
      </label>
      <label className={fieldLabel}>
        {t("kyc.idLast4")}
        <input className={`${field} tabular-nums`} inputMode="numeric" maxLength={4} value={idLast4} onChange={(e) => setIdLast4(e.target.value.replace(/\D/g, ""))} />
      </label>
      <div className="flex flex-col gap-2">
        {KYC_DOCS.map((d) => (
          <DocSlot key={d} doc={d} path={files[d]} onDone={(p) => setFiles((x) => ({ ...x, [d]: p }))} onError={setError} />
        ))}
      </div>
      <label className="flex cursor-pointer items-start gap-3 text-body">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-5 w-5 flex-none accent-brand" />
        <span>{t("verify.consent")}</span>
      </label>
      {error && (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
      <button type="button" disabled={busy} onClick={submit} className={`${btn.primary} w-full`}>
        {busy ? t("common.working") : t("kyc.submit")}
      </button>
    </div>
  );
}
