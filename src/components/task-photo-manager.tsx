"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { prepareTaskPhoto } from "@/app/(app)/post/actions";
import { addTaskPhotosAction, removeTaskPhotoAction } from "@/app/(app)/tasks/[id]/actions";
import { useT } from "@/i18n/client";
import { compressImage } from "@/lib/image-client";
import { browserClient } from "@/lib/supabase/browser";
import type { TaskPhotoView } from "@/lib/task-photos";
import { btn } from "./ui";

const MAX = 5;

/**
 * The customer's own task photos while the task is still open: remove one (✕) or add more, up to 5.
 * Once a helper is chosen the photos are fixed (the helper agreed to the job as shown).
 */
export function TaskPhotoManager({ dealId, photos }: { dealId: string; photos: TaskPhotoView[] }) {
  const t = useT();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      const ids: string[] = [];
      for (const file of Array.from(files).slice(0, MAX - photos.length)) {
        if (!file.type.startsWith("image/")) continue;
        const { blob } = await compressImage(file);
        const slot = await prepareTaskPhoto(blob.size);
        if ("error" in slot) throw new Error(slot.error);
        const up = await browserClient().storage.from("task-photos").uploadToSignedUrl(slot.path, slot.token, blob, { contentType: "image/jpeg" });
        if (up.error) throw new Error(t("taskPhotos.failed"));
        ids.push(slot.id);
      }
      if (ids.length) {
        const r = await addTaskPhotosAction(dealId, ids);
        if (r.error) throw new Error(r.error);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t("taskPhotos.failed"));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    const r = await removeTaskPhotoAction(dealId, id);
    if (r.error) setError(r.error);
    else router.refresh();
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-2">
      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((p, i) => (
            <div key={p.id} className="relative">
              {p.url ? (
                // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage URL
                <img src={p.url} alt={t("taskPhotos.alt", { n: i + 1 })} className="aspect-square w-full rounded-input bg-fill object-cover" />
              ) : (
                <div className="aspect-square w-full rounded-input bg-fill" />
              )}
              <button
                type="button"
                disabled={busy}
                aria-label={t("taskPhotos.removeN", { n: i + 1 })}
                onClick={() => remove(p.id)}
                className="press absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-bg/90 shadow-card"
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
      <input ref={input} type="file" accept="image/*" multiple className="sr-only" onChange={(e) => add(e.target.files)} aria-label={t("taskPhotos.add")} />
      {photos.length < MAX && (
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className={`${btn.secondary} self-start`}>
          {busy ? t("taskPhotos.uploading") : t("taskPhotos.add")}
        </button>
      )}
      <p className="text-meta text-ink-2">{t("taskPhotos.editableUntil")}</p>
      {error && (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
