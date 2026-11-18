import { Star } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { T } from "@/i18n";
import type { WorkPhoto, WorkPhotoCard } from "@/lib/work-photos";

/** "2026.11" in Ulaanbaatar time. */
const month = (ms: number) => {
  const d = new Date(ms + 8 * 3_600_000);
  return `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

/**
 * Home / landing "helpers' work" (PleaseHelp-style portfolio row): the photo, the kind of job, the
 * helper and their rating. Never the task's words, place or the customer.
 */
export function WorkCard({ p, t, href }: { p: WorkPhotoCard; t: T; href: string }) {
  return (
    <Link href={href} className="press flex h-full flex-col overflow-hidden rounded-card bg-bg shadow-card">
      {/* eslint-disable-next-line @next/next/no-img-element -- public work photo in Supabase Storage */}
      <img src={p.url} alt={p.category ? t("workPhotos.altKind", { kind: t(`categoryShort.${p.category}`) }) : t("workPhotos.alt")} loading="lazy" className="aspect-square w-full bg-fill object-cover" />
      <span className="flex flex-col gap-0.5 p-3">
        <span className="truncate text-[14px] font-semibold">{p.category ? t(`categoryShort.${p.category}`) : t("workPhotos.alt")}</span>
        <span className="flex items-center gap-1 truncate text-[12px] text-ink-2">
          {p.helperName}
          {p.rating !== null && (
            <>
              {" · "}
              <Star aria-hidden size={12} className="fill-brand text-brand" /> {p.rating.toFixed(1)}
            </>
          )}
        </span>
      </span>
    </Link>
  );
}

/** A helper's portfolio grid (profile page); `action` adds a per-photo control (report / remove). */
export function PortfolioGrid({ photos, t, action }: { photos: WorkPhoto[]; t: T; action?: (p: WorkPhoto) => ReactNode }) {
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {photos.map((p) => (
        <li key={p.id} className="flex flex-col overflow-hidden rounded-card bg-bg shadow-card">
          <a href={p.url} target="_blank" rel="noopener noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element -- public work photo in Supabase Storage */}
            <img src={p.url} alt={p.category ? t("workPhotos.altKind", { kind: t(`categoryShort.${p.category}`) }) : t("workPhotos.alt")} loading="lazy" className="aspect-square w-full bg-fill object-cover" />
          </a>
          <span className="flex items-center justify-between gap-1 px-2.5 py-1.5 text-[12px] text-ink-2">
            <span className="truncate">
              {p.category ? t(`categoryShort.${p.category}`) : ""} · {month(p.at)}
              {p.source === "review" ? ` · ${t("workPhotos.fromReview")}` : ""}
            </span>
            {action?.(p)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Small photo strip (helper cards, reviews). */
export function PhotoStrip({ urls, t, size = "h-16" }: { urls: string[]; t: T; size?: string }) {
  if (!urls.length) return null;
  return (
    <span className="grid grid-cols-3 gap-1.5">
      {urls.slice(0, 3).map((u, i) => (
        // eslint-disable-next-line @next/next/no-img-element -- public work photo in Supabase Storage
        <img key={u} src={u} alt={t("taskPhotos.alt", { n: i + 1 })} loading="lazy" className={`${size} w-full rounded-input bg-fill object-cover`} />
      ))}
    </span>
  );
}
