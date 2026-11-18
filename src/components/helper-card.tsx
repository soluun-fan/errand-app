import { Heart, MapPin, Star } from "lucide-react";
import Link from "next/link";
import type { T } from "@/i18n";
import { fmtMoney } from "@/lib/format";
import type { HelperProfile } from "@/lib/helper-profile";
import { CategoryIcon } from "./category-icon";
import { Avatar } from "./ui";
import { PhotoStrip } from "./work-photos";

/** A helper in the directory (PleaseHelp "recommended helpers" style): who, trust, what they do. */
export function HelperCard({ h, t, saved = false, photos = [] }: { h: HelperProfile; t: T; saved?: boolean; photos?: string[] }) {
  const shown = h.categories.slice(0, 3);
  return (
    <Link href={`/helpers/${h.id}`} className="press flex h-full flex-col gap-3 rounded-card bg-bg p-4 shadow-card">
      <span className="flex items-start gap-3">
        <Avatar name={h.name} size={48} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[16px] font-bold">{h.name}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-ink-2">
            {h.rating !== null ? (
              <span className="inline-flex items-center gap-0.5 font-semibold text-ink">
                <Star aria-hidden size={13} className="fill-brand text-brand" /> {h.rating.toFixed(1)}
                <span className="font-normal text-ink-2">({h.ratingCount})</span>
              </span>
            ) : (
              <span>{t("deal.newHelper")}</span>
            )}
            <span>· {t("deal.tasks", { n: h.completed })}</span>
          </span>
        </span>
        {saved && <Heart aria-label={t("helperProfile.saved")} size={18} className="flex-none fill-current text-brand-ink" />}
      </span>
      {h.bio && <span className="line-clamp-2 text-[13px] leading-snug text-ink-2">{h.bio}</span>}
      <PhotoStrip urls={photos} t={t} />
      <span className="flex flex-wrap gap-1.5">
        {h.fromPrice && (
          <span className="rounded-[8px] bg-brand-bg px-2 py-1 text-[12px] font-bold tabular-nums text-brand-ink">{t("home.from", { amount: fmtMoney(h.fromPrice) })}</span>
        )}
        {h.kycLevel >= 3 && <span className="rounded-[8px] bg-held-bg px-2 py-1 text-[12px] font-semibold text-held">{t("kyc.badgeVerified")}</span>}
        {h.kycLevel >= 4 && <span className="rounded-[8px] bg-held-bg px-2 py-1 text-[12px] font-semibold text-held">{t("kyc.badgeRecord")}</span>}
      </span>
      <span className="mt-auto flex flex-wrap items-center gap-1.5 text-[12px] text-ink-2">
        {shown.map((c) => (
          <span key={c} className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5">
            <CategoryIcon id={c} size={12} /> {t(`categoryShort.${c}`)}
          </span>
        ))}
        {h.categories.length > shown.length && <span>+{h.categories.length - shown.length}</span>}
        {h.area && (
          <span className="inline-flex items-center gap-0.5">
            <MapPin aria-hidden size={12} /> {h.area}
          </span>
        )}
      </span>
    </Link>
  );
}
