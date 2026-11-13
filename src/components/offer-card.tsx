import type { ReactNode } from "react";
import type { T } from "@/i18n";
import { Avatar } from "./ui";

export interface OfferPerson {
  name: string;
  rating: number | null;
  ratingCount: number;
  completed: number;
  verified: boolean;
}

/** UI-FLOWS C4 offer card: name, ✓ level, ★ rating (count), jobs done, message, Choose. */
export function OfferCard({
  person,
  note,
  t,
  action,
  badge,
}: {
  person: OfferPerson;
  note?: string;
  t: T;
  action?: ReactNode;
  /** e.g. "Санал болгосон" on the best-ranked applicant. */
  badge?: string;
}) {
  return (
    <div className={`flex flex-col gap-2 rounded-card border bg-bg p-4 ${badge ? "border-2 border-ink" : "border-line"}`}>
      {badge && <span className="self-start rounded-full bg-ink px-2.5 py-0.5 text-xs font-bold text-white">★ {badge}</span>}
      <div className="flex items-center gap-3">
        <Avatar name={person.name} size={56} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[18px] font-semibold">
            <span className="truncate">{person.name}</span>
            {person.verified && (
              <span title={t("deal.verified")} className="rounded-full bg-held-bg px-1.5 py-0.5 text-[11px] font-bold text-held">
                ✓ ДАН
              </span>
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
    </div>
  );
}
