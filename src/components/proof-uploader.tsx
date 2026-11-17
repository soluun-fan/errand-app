"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { prepareProof, submitProof } from "@/app/(app)/jobs/actions";
import { useT } from "@/i18n/client";
import { compressImage, dhashOfBitmap, sha256Hex } from "@/lib/image-client";
import { browserClient } from "@/lib/supabase/browser";
import { btn, field, fieldLabel } from "./ui";

function position(): Promise<{ lat: number; lng: number } | null> {
  if (!("geolocation" in navigator)) return Promise.resolve(null);
  return new Promise((ok) =>
    navigator.geolocation.getCurrentPosition(
      (p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => ok(null),
      { timeout: 4000, maximumAge: 60_000 },
    ),
  );
}

type Kind = "receipt" | "handover" | "start" | "progress";

const TEXT = {
  receipt: { title: "proof.receiptTitle", sub: "proof.receiptSub" },
  handover: { title: "proof.handoverTitle", sub: "proof.handoverSub" },
  start: { title: "proof.startTitle", sub: "proof.startSub" },
  progress: { title: "proof.progressTitle", sub: "proof.progressSub" },
} as const;

/**
 * One proof slot (docs/rules.md §Proof): camera → compress → fingerprint → signed upload → record.
 * Receipts need the total; the start photo starts the job; progress photos may carry a short note;
 * handover and progress accept a photo or a short video.
 */
export function ProofUploader({ dealId, kind, done, compact = false }: { dealId: string; kind: Kind; done: boolean; /** just the button (for the bottom bar) */ compact?: boolean }) {
  const t = useT();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    const total = Number(amount.replace(/[^\d]/g, ""));
    if (kind === "receipt" && !(total > 0)) {
      setError(t("proof.amountNeeded"));
      return;
    }
    setBusy(true);
    try {
      const isVideo = file.type.startsWith("video/");
      let blob: Blob = file;
      let dhash: string | null = null;
      if (!isVideo) {
        const c = await compressImage(file);
        blob = c.blob;
        dhash = dhashOfBitmap(c.bitmap) || null;
      }
      const mime = isVideo ? file.type : "image/jpeg";
      const [hash, pos] = await Promise.all([sha256Hex(blob), position()]);
      const slot = await prepareProof(dealId, kind, mime, blob.size);
      if ("error" in slot) throw new Error(slot.error);
      const up = await browserClient().storage.from("proofs").uploadToSignedUrl(slot.path, slot.token, blob, { contentType: mime });
      if (up.error) throw new Error(t("proof.failed"));
      const r = await submitProof({
        dealId,
        kind,
        path: slot.path,
        mime,
        bytes: blob.size,
        sha256: hash,
        dhash,
        amount: kind === "receipt" ? total : null,
        lat: pos?.lat ?? null,
        lng: pos?.lng ?? null,
        takenAt: file.lastModified || null,
        note: kind === "progress" ? note.trim() || null : null,
      });
      if (r.error) throw new Error(r.error);
      setNote("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t("proof.failed"));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  function label() {
    if (kind === "start") return t("proof.startTake");
    if (kind === "progress") return t("proof.progressTake");
    if (done) return `📷 ${t("proof.retake")}`;
    return `📷 ${kind === "receipt" ? t("proof.take") : t("proof.takeOrVideo")}`;
  }

  const fileInput = (
    <input
      ref={input}
      type="file"
      accept={kind === "receipt" || kind === "start" ? "image/*" : "image/*,video/*"}
      capture="environment"
      className="sr-only"
      onChange={(e) => onFile(e.target.files?.[0])}
    />
  );
  if (compact) {
    return (
      <div className="flex w-full flex-col gap-1">
        {fileInput}
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className={`${btn.primary} w-full`}>
          {busy ? t("proof.uploading") : label()}
        </button>
        {error && (
          <p role="alert" className="text-center text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-card border border-line bg-bg p-4">
      <div>
        <p className="font-semibold">
          {t(TEXT[kind].title)} {done && <span className="text-held">· {t("proof.done")}</span>}
        </p>
        <p className="text-sm text-ink-2">{t(TEXT[kind].sub)}</p>
      </div>
      {kind === "receipt" && (
        <label className={fieldLabel}>
          {t("proof.amount")}
          <input
            className={`${field} text-[20px] font-bold tabular-nums`}
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
            placeholder="18500"
          />
        </label>
      )}
      {kind === "progress" && (
        <input className={field} value={note} maxLength={140} onChange={(e) => setNote(e.target.value)} placeholder={t("proof.progressNotePh")} aria-label={t("proof.progressNotePh")} />
      )}
      {fileInput}
      <button type="button" disabled={busy} onClick={() => input.current?.click()} className={done || kind === "progress" ? btn.secondary : `${btn.primary} w-full`}>
        {busy ? t("proof.uploading") : label()}
      </button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
