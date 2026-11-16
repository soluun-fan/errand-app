"use client";

import { useRef, useState } from "react";
import { CategoryIcon } from "@/components/category-icon";
import { btn, chipClass, field, fieldLabel } from "@/components/ui";
import { useT } from "@/i18n/client";
import { CATEGORIES } from "@/lib/engine/config";
import { compressImage } from "@/lib/image-client";
import { BANKS, KYC_DOCS, type KycDoc } from "@/lib/kyc-rules";
import { browserClient } from "@/lib/supabase/browser";
import { prepareKycUpload, submitKyc } from "./actions";

/** One document slot: camera / file → (compress if photo) → signed upload into the applicant's folder. */
function DocSlot({ doc, path, onDone, onError }: { doc: KycDoc; path: string | undefined; onDone: (p: string) => void; onError: (m: string) => void }) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pdfOk = doc === "record";

  async function onFile(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    try {
      const isPdf = f.type === "application/pdf";
      if (isPdf && !pdfOk) throw new Error(t("kyc.errors.type"));
      const blob: Blob = isPdf ? f : (await compressImage(f)).blob;
      const mime = isPdf ? "application/pdf" : "image/jpeg";
      const slot = await prepareKycUpload(doc, mime, blob.size);
      if ("error" in slot) throw new Error(slot.error);
      const up = await browserClient().storage.from("kyc").uploadToSignedUrl(slot.path, slot.token, blob, { contentType: mime });
      if (up.error) throw new Error(t("proof.failed"));
      onDone(slot.path);
    } catch (e) {
      onError(e instanceof Error && e.message ? e.message : t("proof.failed"));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-card bg-bg p-3 shadow-card">
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold">{t(`kyc.docs.${doc}`)}</span>
        {doc === "record" && <span className="block text-sm text-ink-2">{t("kyc.recordHelp")}</span>}
        {path && <span className="block text-sm text-held">{t("kyc.uploaded")}</span>}
      </span>
      <input
        ref={input}
        type="file"
        className="sr-only"
        accept={pdfOk ? "image/*,application/pdf" : "image/*"}
        capture={doc === "selfie" ? "user" : doc === "record" ? undefined : "environment"}
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      <button type="button" disabled={busy} onClick={() => input.current?.click()} className={path ? btn.secondary : btn.small}>
        {busy ? "…" : path ? t("kyc.replace") : pdfOk ? t("kyc.uploadPdf") : t("kyc.upload")}
      </button>
    </div>
  );
}

/** Helper verification form (docs/decisions.md 2026-11-15). Every field is re-checked on the server. */
export function ApplyForm() {
  const t = useT();
  const [legalName, setLegalName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [idLast4, setIdLast4] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [files, setFiles] = useState<Partial<Record<KycDoc, string>>>({});
  const [bank, setBank] = useState("");
  const [account, setAccount] = useState("");
  const [holder, setHolder] = useState("");
  const [holderTouched, setHolderTouched] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (c: string) => setCategories((x) => (x.includes(c) ? x.filter((y) => y !== c) : [...x, c]));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await submitKyc({ legalName, birthDate, idLast4, categories, files, bank, accountNumber: account, holderName: holderTouched ? holder : legalName, consent });
      if (r?.error) setError(r.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="font-bold">{t("kyc.stepPerson")}</h2>
        <label className={fieldLabel}>
          {t("kyc.legalName")}
          <input className={field} value={legalName} maxLength={80} autoComplete="name" onChange={(e) => setLegalName(e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className={fieldLabel}>
            {t("kyc.birthDate")}
            <input type="date" className={field} value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
          </label>
          <label className={fieldLabel}>
            {t("kyc.idLast4")}
            <input className={field} inputMode="numeric" maxLength={4} value={idLast4} onChange={(e) => setIdLast4(e.target.value.replace(/\D/g, ""))} />
          </label>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-bold">{t("kyc.stepDocs")}</h2>
        {KYC_DOCS.map((d) => (
          <DocSlot key={d} doc={d} path={files[d]} onDone={(p) => setFiles((x) => ({ ...x, [d]: p }))} onError={setError} />
        ))}
        <p className="text-sm text-ink-2">🔒 {t("kyc.privacy")}</p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-bold">{t("kyc.stepWork")}</h2>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-[15px] font-medium text-ink-2">{t("kyc.categories")}</legend>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <button key={c.id} type="button" role="checkbox" aria-checked={categories.includes(c.id)} onClick={() => toggle(c.id)} className={chipClass(categories.includes(c.id))}>
                <CategoryIcon id={c.id} size={16} /> {t(`categoryShort.${c.id}`)}
              </button>
            ))}
          </div>
        </fieldset>
        <label className={fieldLabel}>
          {t("kyc.bank")}
          <select className={field} value={bank} onChange={(e) => setBank(e.target.value)}>
            <option value="" />
            {BANKS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        <label className={fieldLabel}>
          {t("kyc.account")}
          <input className={field} inputMode="text" autoComplete="off" maxLength={34} value={account} onChange={(e) => setAccount(e.target.value)} />
        </label>
        <label className={fieldLabel}>
          {t("kyc.holder")}
          <input
            className={field}
            value={holderTouched ? holder : legalName}
            maxLength={80}
            onChange={(e) => {
              setHolderTouched(true);
              setHolder(e.target.value);
            }}
          />
          <span className="text-sm font-normal">{t("kyc.holderHelp")}</span>
        </label>
      </section>

      <label className="flex items-start gap-3 text-[15px]">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-5 w-5 flex-none accent-ink" />
        <span>{t("kyc.consent")}</span>
      </label>

      {error && (
        <p role="alert" className="rounded-input bg-danger-bg p-3 text-sm text-danger">
          {error}
        </p>
      )}
      <button type="button" disabled={busy} onClick={submit} className={`${btn.primary} w-full`}>
        {busy ? "…" : t("kyc.submit")}
      </button>
    </div>
  );
}
