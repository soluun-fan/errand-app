"use client";

import { useRef, useState } from "react";
import { btn } from "@/components/ui";
import { useT } from "@/i18n/client";
import { compressImage } from "@/lib/image-client";
import { browserClient } from "@/lib/supabase/browser";
import { UserError, shownError } from "@/lib/user-error";

/**
 * One document (registration certificate, trade certificate): photo or PDF → a one-time signed
 * upload into the person's own folder of the private `kyc` bucket. `prepare` is a server action
 * that checks the type and size and returns the slot; the server checks the file exists on submit.
 */
export function DocUpload({
  label,
  help,
  path,
  prepare,
  onDone,
  onError,
}: {
  label: string;
  help?: string;
  path: string | undefined;
  prepare: (mime: string, bytes: number) => Promise<{ path: string; token: string } | { error: string }>;
  onDone: (path: string) => void;
  onError: (message: string) => void;
}) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    try {
      const isPdf = f.type === "application/pdf";
      const blob: Blob = isPdf ? f : (await compressImage(f)).blob;
      const mime = isPdf ? "application/pdf" : "image/jpeg";
      const slot = await prepare(mime, blob.size);
      if ("error" in slot) throw new UserError(slot.error);
      const up = await browserClient().storage.from("kyc").uploadToSignedUrl(slot.path, slot.token, blob, { contentType: mime });
      if (up.error) throw new UserError(t("proof.failed"));
      onDone(slot.path);
    } catch (e) {
      onError(shownError(e, t("proof.failed")));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-card bg-bg p-3 shadow-card">
      <span className="min-w-0 flex-1">
        <span className="block text-body font-semibold">{label}</span>
        {help && <span className="block text-small text-ink-2">{help}</span>}
        {path && <span className="block text-small text-held">{t("kyc.uploaded")}</span>}
      </span>
      <input ref={input} type="file" className="sr-only" accept="image/*,application/pdf" onChange={(e) => onFile(e.target.files?.[0])} />
      <button type="button" disabled={busy} onClick={() => input.current?.click()} className={path ? btn.secondary : btn.small}>
        {busy ? "…" : path ? t("kyc.replace") : t("kyc.uploadPdf")}
      </button>
    </div>
  );
}
