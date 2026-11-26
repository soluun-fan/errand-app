import { Star } from "lucide-react";
import Link from "next/link";
import type { T } from "@/i18n";
import type { RecentReview } from "@/lib/helper-profile";

/** A recent review (reviewer masked "С*****"; contact details already removed from the note). */
export function ReviewCard({ r, t }: { r: RecentReview; t: T }) {
  const d = new Date(r.at + 8 * 3_600_000);
  const date = `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${String(d.getUTCDate()).padStart(2, "0")}`;
  return (
    <article className="flex h-full flex-col gap-2 overflow-hidden rounded-card bg-bg p-4 shadow-card">
      {r.photos[0] && (
        // eslint-disable-next-line @next/next/no-img-element -- public review photo in Supabase Storage
        <img src={r.photos[0]} alt={t("workPhotos.reviewPhoto")} loading="lazy" className="-mx-4 -mt-4 mb-1 aspect-[4/3] w-[calc(100%+2rem)] max-w-none bg-fill object-cover" />
      )}
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="flex shrink-0" aria-label={t("helperProfile.stars", { n: r.stars })}>
          {[1, 2, 3, 4, 5].map((s) => (
            <Star key={s} aria-hidden size={14} className={s <= r.stars ? "fill-brand text-brand" : "text-line"} />
          ))}
        </span>
        <span className="text-caption text-ink-2">
          {r.category ? `${t(`categoryShort.${r.category}`)} · ` : ""}
          {date}
        </span>
      </span>
      <p className="line-clamp-3 flex-1 text-small leading-relaxed">{r.note}</p>
      <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line pt-2 text-meta">
        <Link href={`/helpers/${r.helperId}`} className="flex min-h-11 min-w-0 items-center break-words font-semibold text-brand-ink">
          {r.helperName} ›
        </Link>
        <span className="text-ink-2">{r.reviewer}</span>
      </span>
    </article>
  );
}
