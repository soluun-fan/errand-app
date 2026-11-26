"use client";

import { X } from "lucide-react";
import { useRef, useState } from "react";
import { prepareTaskPhoto } from "@/app/(app)/post/actions";
import { useT } from "@/i18n/client";
import { compressImage } from "@/lib/image-client";
import { browserClient } from "@/lib/supabase/browser";
import { btn } from "./ui";
import { UserError, shownError } from "@/lib/user-error";

export interface PickedPhoto {
  id: string;
  /** local preview (object URL) */
  preview: string;
}

const MAX = 5;

/**
 * Up to 5 photos while posting (docs/rules.md §Proof "Task photos"). Each picture is re-encoded to
 * JPEG in the browser (smaller, and the location data inside the file is dropped), then uploaded
 * through a signed URL; the form sends only the ids, and the server attaches them to the new task.
 */
export function TaskPhotoPicker({ value, onChange }: { value: PickedPhoto[]; onChange: (next: PickedPhoto[]) => void }) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    setBusy(true);
    let next = value;
    try {
      for (const file of Array.from(files).slice(0, MAX - value.length)) {
        if (!file.type.startsWith("image/")) continue;
        const { blob } = await compressImage(file);
        const slot = await prepareTaskPhoto(blob.size);
        if ("error" in slot) throw new UserError(slot.error);
        const up = await browserClient().storage.from("task-photos").uploadToSignedUrl(slot.path, slot.token, blob, { contentType: "image/jpeg" });
        if (up.error) throw new UserError(t("taskPhotos.failed"));
        next = [...next, { id: slot.id, preview: URL.createObjectURL(blob) }];
        onChange(next);
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
      <div>
        <p className="font-semibold">{t("taskPhotos.title")}</p>
        <p className="text-small text-ink-2">{t("taskPhotos.sub")}</p>
      </div>
      {value.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {value.map((p, i) => (
            <div key={p.id} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
              <img src={p.preview} alt={t("taskPhotos.alt", { n: i + 1 })} className="aspect-square w-full rounded-input bg-fill object-cover" />
              <button
                type="button"
                aria-label={t("taskPhotos.remove")}
                onClick={() => onChange(value.filter((x) => x.id !== p.id))}
                className="press absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-bg/90 shadow-card"
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
      <input ref={input} type="file" accept="image/*" multiple className="sr-only" onChange={(e) => onFiles(e.target.files)} />
      {value.length < MAX && (
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
