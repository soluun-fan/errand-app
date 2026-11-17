"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { CategoryIcon } from "@/components/category-icon";
import { btn } from "@/components/ui";
import { useT } from "@/i18n/client";
import type { CategoryId } from "@/lib/engine";
import { compressImage } from "@/lib/image-client";
import { browserClient } from "@/lib/supabase/browser";
import { prepareCover, saveCover } from "../actions";

/** One kind's example picture: shown on cards and Home when a task has no photo of its own. */
export function CoverForm({ category, url }: { category: CategoryId; url: string | null }) {
  const t = useT();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const { blob } = await compressImage(file);
      const slot = await prepareCover(category, blob.size);
      if ("error" in slot) throw new Error(slot.error);
      const up = await browserClient().storage.from("kind-covers").uploadToSignedUrl(slot.path, slot.token, blob, { contentType: "image/jpeg" });
      if (up.error) throw new Error(t("taskPhotos.failed"));
      const r = await saveCover(category, slot.path);
      if (r.error) throw new Error(r.error);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t("taskPhotos.failed"));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function clear() {
    setBusy(true);
    const r = await saveCover(category, null);
    if (r.error) setError(r.error);
    else router.refresh();
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-2 rounded-card bg-bg p-3 shadow-card">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- public cover in Supabase Storage
        <img src={url} alt={t(`categoryShort.${category}`)} className="aspect-[4/3] w-full rounded-input bg-fill object-cover" />
      ) : (
        <div className="flex aspect-[4/3] w-full items-center justify-center rounded-input bg-fill">
          <CategoryIcon id={category} tile size={28} />
        </div>
      )}
      <span className="text-[14px] font-semibold">{t(`categoryShort.${category}`)}</span>
      <input ref={input} type="file" accept="image/*" className="sr-only" onChange={(e) => upload(e.target.files?.[0])} aria-label={t("opsContent.coverUpload", { kind: t(`categoryShort.${category}`) })} />
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className={`${btn.small} flex-1`}>
          {busy ? t("taskPhotos.uploading") : url ? t("opsContent.coverChange") : t("opsContent.coverAdd")}
        </button>
        {url && (
          <button type="button" disabled={busy} onClick={clear} className={`${btn.text} min-h-10 px-2 text-danger`}>
            {t("opsContent.coverRemove")}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
