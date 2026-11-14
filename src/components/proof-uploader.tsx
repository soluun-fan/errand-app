"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { prepareProof, submitProof } from "@/app/(app)/jobs/actions";
import { useT } from "@/i18n/client";
import { dhashFromGray, grayFromRgba } from "@/lib/proof-hash";
import { browserClient } from "@/lib/supabase/browser";
import { btn, field, fieldLabel } from "./ui";

const MAX_SIDE = 1600;

/** Downscale + re-encode a photo as JPEG (small uploads on mobile data; strips nothing we rely on). */
async function compress(file: File): Promise<{ blob: Blob; bitmap: ImageBitmap }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error("encode"))), "image/jpeg", 0.82));
  return { blob, bitmap };
}

function dhashOf(bitmap: ImageBitmap): string {
  const c = document.createElement("canvas");
  c.width = 9;
  c.height = 8;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return "";
  ctx.drawImage(bitmap, 0, 0, 9, 8);
  return dhashFromGray(grayFromRgba(ctx.getImageData(0, 0, 9, 8).data));
}

async function sha256(blob: Blob): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

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

/**
 * One proof slot (docs/rules.md §Proof): camera → compress → fingerprint → signed upload → record.
 * Receipts need the total; handover accepts a photo or a short video.
 */
export function ProofUploader({ dealId, kind, done }: { dealId: string; kind: "receipt" | "handover"; done: boolean }) {
  const t = useT();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [amount, setAmount] = useState("");
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
        const c = await compress(file);
        blob = c.blob;
        dhash = dhashOf(c.bitmap) || null;
      }
      const mime = isVideo ? file.type : "image/jpeg";
      const [hash, pos] = await Promise.all([sha256(blob), position()]);
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
      });
      if (r.error) throw new Error(r.error);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t("proof.failed"));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-card border border-line p-4">
      <div>
        <p className="font-semibold">
          {kind === "receipt" ? t("proof.receiptTitle") : t("proof.handoverTitle")} {done && <span className="text-held">· {t("proof.done")}</span>}
        </p>
        <p className="text-sm text-ink-2">{kind === "receipt" ? t("proof.receiptSub") : t("proof.handoverSub")}</p>
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
      <input
        ref={input}
        type="file"
        accept={kind === "receipt" ? "image/*" : "image/*,video/*"}
        capture="environment"
        className="sr-only"
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      <button type="button" disabled={busy} onClick={() => input.current?.click()} className={done ? btn.secondary : `${btn.primary} w-full`}>
        {busy ? t("proof.uploading") : done ? `📷 ${t("proof.retake")}` : `📷 ${kind === "receipt" ? t("proof.take") : t("proof.takeOrVideo")}`}
      </button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
