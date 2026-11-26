"use client";

import { X } from "lucide-react";
import { useRef, useState } from "react";
import { prepareReviewPhoto } from "@/app/(app)/helpers/photo-actions";
import { useT } from "@/i18n/client";
import { compressImage } from "@/lib/image-client";
import { browserClient } from "@/lib/supabase/browser";
import { btn } from "./ui";
import { UserError, shownError } from "@/lib/user-error";

const MAX = 3;

/**
 * Up to 3 photos with a review (docs/decisions.md 2026-11-18 "Work photos"). Re-encoded to JPEG in
 * the browser (drops the location inside the file), uploaded privately; they go public only when
 * the rating is sent. The form carries the ids as `reviewPhotos`.
 */
export function ReviewPhotoPicker({ dealId }: { dealId: string }) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<{ id: string; preview: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    setBusy(true);
    try {
      let next = photos;
      for (const file of Array.from(files).slice(0, MAX - photos.length)) {
        if (!file.type.startsWith("image/")) continue;
        const { blob } = await compressImage(file);
        const slot = await prepareReviewPhoto(dealId);
        if ("error" in slot) throw new UserError(slot.error);
        const up = await browserClient().storage.from("task-photos").uploadToSignedUrl(slot.path, slot.token, blob, { contentType: "image/jpeg" });
        if (up.error) throw new UserError(t("taskPhotos.failed"));
        next = [...next, { id: slot.id, preview: URL.createObjectURL(blob) }];
        setPhotos(next);
      }
    } catch (e) {
      setError(shownError(e, t("taskPhotos.failed")));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <input type="hidden" name="reviewPhotos" value={JSON.stringify(photos.map((p) => p.id))} />
      <p className="text-small font-semibold">{t("workPhotos.reviewAdd")}</p>
      <p className="-mt-1 text-meta text-ink-2">{t("workPhotos.reviewSub")}</p>
      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((p, i) => (
            <div key={p.id} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
              <img src={p.preview} alt={t("taskPhotos.alt", { n: i + 1 })} className="aspect-square w-full rounded-input bg-fill object-cover" />
              <button
                type="button"
                aria-label={t("taskPhotos.remove")}
                onClick={() => setPhotos(photos.filter((x) => x.id !== p.id))}
                className="press absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-bg/90 shadow-card"
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
      <input ref={input} type="file" accept="image/*" multiple className="sr-only" onChange={(e) => onFiles(e.target.files)} />
      {photos.length < MAX && (
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className={`${btn.secondary} self-start`}>
          {busy ? t("taskPhotos.uploading") : t("taskPhotos.add")}
        </button>
      )}
      {error && (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
