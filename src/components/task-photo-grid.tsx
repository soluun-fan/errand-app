import type { T } from "@/i18n";
import type { TaskPhotoView } from "@/lib/task-photos";

/** The customer's photos of a task (signed URLs, valid 1 h); tap opens the full picture. */
export function TaskPhotoGrid({ photos, t }: { photos: TaskPhotoView[]; t: T }) {
  if (!photos.length) return null;
  return (
    <div className="grid grid-cols-3 gap-2" aria-label={t("taskPhotos.heading")}>
      {photos.map((p, i) =>
        p.url ? (
          <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage URL */}
            <img src={p.url} alt={t("taskPhotos.alt", { n: i + 1 })} className="aspect-square w-full rounded-input bg-fill object-cover" />
          </a>
        ) : (
          <div key={p.id} className="aspect-square w-full rounded-input bg-fill" />
        ),
      )}
    </div>
  );
}
