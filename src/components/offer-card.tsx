import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { T } from "@/i18n";
import { Avatar } from "./ui";

export interface OfferPerson {
  name: string;
  rating: number | null;
  ratingCount: number;
  completed: number;
  verified: boolean;
  /** Criminal-record certificate checked by Ops (kyc_level 4). */
  backgroundChecked?: boolean;
}

/** UI-FLOWS C4 offer card: name, ✓ level, ★ rating (count), jobs done, message, Choose. */
export function OfferCard({
  person,
  note,
  t,
  action,
  badge,
  href,
}: {
  person: OfferPerson;
  note?: string;
  t: T;
  action?: ReactNode;
  /** e.g. "Санал болгосон" on the best-ranked applicant. */
  badge?: string;
  /** The helper's public profile (reviews, badges, jobs done). */
  href?: string;
}) {
  return (
    <div className={`flex flex-col gap-2 rounded-card bg-bg p-4 shadow-card ${badge ? "border-2 border-brand" : ""}`}>
      {badge && <span className="self-start rounded-full bg-brand-bg px-2.5 py-0.5 text-xs font-bold text-brand-ink">★ {badge}</span>}
      <div className="flex items-center gap-3">
        <Avatar name={person.name} size={56} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[18px] font-semibold">
            <span className="truncate">{person.name}</span>
            {person.verified && (
              <span className="rounded-full bg-held-bg px-1.5 py-0.5 text-[11px] font-bold text-held">{t("kyc.badgeVerified")}</span>
            )}
            {person.backgroundChecked && (
              <span className="rounded-full bg-held-bg px-1.5 py-0.5 text-[11px] font-bold text-held">{t("kyc.badgeRecord")}</span>
            )}
          </p>
          <p className="text-sm text-ink-2">
            {person.rating !== null ? (
              <>
                <span className="text-warn">★</span> {person.rating} ({person.ratingCount})
              </>
            ) : (
              t("deal.newHelper")
            )}{" "}
            · {t("deal.tasks", { n: person.completed })}
          </p>
        </div>
        {action}
      </div>
      {note && <p className="rounded-input bg-fill p-2.5 text-[15px] text-ink">“{note}”</p>}
      {href && (
        <Link href={href} className="flex min-h-10 items-center gap-1 self-start text-[14px] font-semibold text-brand-ink">
          {t("helperProfile.viewProfile")} <ChevronRight aria-hidden size={16} />
        </Link>
      )}
    </div>
  );
}
