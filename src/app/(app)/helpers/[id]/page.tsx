import { orgBadges } from "@/lib/orgs";
import { MapPin, Send, Star } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CategoryIcon } from "@/components/category-icon";
import { Avatar, FlowHeader, PrimaryBar, btn } from "@/components/ui";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { fmtMoney } from "@/lib/format";
import { helperHighlights, helperProfile, helperReviews, invitableHelper, isSaved, typicalPrice } from "@/lib/helper-profile";
import { Uuid, parseOr } from "@/lib/input";
import { getMode } from "@/lib/mode";
import { getPricing } from "@/lib/pricing";
import { ListingEditor } from "../listing-editor";
import { SaveButton } from "../save-button";

/** Ulaanbaatar calendar date as "2026.11" (month) or "2026.11.16" (day) — short, same in both languages. */
const ubDate = (ms: number, withDay = false) => {
  const d = new Date(ms + 8 * 3_600_000); // UTC+8, no DST
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}.${p(d.getUTCMonth() + 1)}${withDay ? `.${p(d.getUTCDate())}` : ""}`;
};

/**
 * /helpers/[id] — a helper's public profile (UBCab-driver-card style): badges, rating, jobs done,
 * member since, what they do, highlights and reviews (reviewer masked). Approved helpers only.
 */
export default async function HelperProfilePage({ params }: PageProps<"/helpers/[id]">) {
  const viewer = await getViewer();
  if (!viewer) return null;
  const id = parseOr(Uuid, (await params).id);
  if (!id) notFound();
  const [t, p] = await Promise.all([getT(), helperProfile(id)]);
  if (!p) notFound();
  const me = viewer.profile.id === p.id;
  const [reviews, highlights, saved, mode, typical, invitable, pricing] = await Promise.all([
    helperReviews(p.id),
    helperHighlights(p.id),
    me ? false : isSaved(viewer.profile.id, p.id),
    getMode(),
    typicalPrice(p.id),
    me ? null : invitableHelper(p.id),
    me ? getPricing() : null,
  ]);

  const stat = (value: React.ReactNode, label: string) => (
    <div className="flex flex-col items-center gap-0.5 px-2 text-center">
      <span className="text-[18px] font-bold tabular-nums">{value}</span>
      <span className="text-[12px] text-ink-2">{label}</span>
    </div>
  );

  const organizations = (await orgBadges([p.id])).get(p.id) ?? [];
  return (
    <>
      <FlowHeader href={mode === "helper" ? "/jobs" : "/"} label={t("common.back")} title={t("helperProfile.title")} />
      {me && <p className="rounded-card bg-brand-bg p-3 text-[14px] text-brand-ink">{t("helperProfile.yours")}</p>}

      <section className="flex flex-col items-center gap-3 rounded-card bg-bg p-5 text-center shadow-card">
        <Avatar name={p.name} size={76} />
        <div className="flex flex-col items-center gap-1.5">
          <h1 className="text-[22px] font-bold tracking-tight">{p.name}</h1>
          <span className="flex flex-wrap justify-center gap-1.5">
            {p.kycLevel >= 3 && (
              <span className="rounded-full bg-held-bg px-2.5 py-1 text-[12px] font-bold text-held">{t("kyc.badgeVerified")}</span>
            )}
            {p.kycLevel >= 4 && (
              <span className="rounded-full bg-held-bg px-2.5 py-1 text-[12px] font-bold text-held">{t("kyc.badgeRecord")}</span>
            )}
          </span>
          {p.area && (
            <span className="flex items-center gap-1 text-[13px] text-ink-2">
              <MapPin aria-hidden size={14} /> {p.area}
            </span>
          )}
        </div>
        <div className="grid w-full grid-cols-3 divide-x divide-line border-t border-line pt-3">
          {stat(
            p.rating !== null ? (
              <span className="inline-flex items-center gap-1">
                <Star aria-hidden size={16} className="fill-brand text-brand" />
                {p.rating.toFixed(1)}
              </span>
            ) : (
              "—"
            ),
            t("helperProfile.reviewsN", { n: p.ratingCount }),
          )}
          {stat(p.completed, t("helperProfile.jobsDone"))}
          {stat(ubDate(p.memberSince), t("helperProfile.memberSince"))}
        </div>
      </section>

      {/* the helper's own words and price, then what their finished jobs actually paid */}
      {(p.bio || p.fromPrice || typical || me) && (
        <section className="flex flex-col gap-3 rounded-card bg-bg p-4 shadow-card">
          <h2 className="text-[13px] font-semibold text-ink-2">{t("listing.about")}</h2>
          {p.bio ? (
            <p className="whitespace-pre-line text-[15px] leading-relaxed">{p.bio}</p>
          ) : (
            me && <p className="text-[14px] text-ink-2">{t("listing.emptyMine")}</p>
          )}
          {(p.fromPrice || typical) && (
            <dl className="grid grid-cols-2 gap-2 border-t border-line pt-3">
              {p.fromPrice && (
                <div className="flex flex-col">
                  <dt className="text-[12px] text-ink-2">{t("listing.fromPriceShown")}</dt>
                  <dd className="text-[18px] font-bold tabular-nums text-brand-ink">{t("home.from", { amount: fmtMoney(p.fromPrice) })}</dd>
                </div>
              )}
              {typical && (
                <div className="flex flex-col">
                  <dt className="text-[12px] text-ink-2">{t("listing.typical", { n: typical.jobs })}</dt>
                  <dd className="text-[18px] font-bold tabular-nums">{fmtMoney(typical.median)}</dd>
                </div>
              )}
            </dl>
          )}
          {me && pricing && <ListingEditor bio={p.bio} fromPrice={p.fromPrice} minPrice={pricing.baseFee} />}
        </section>
      )}

      {highlights.length > 0 && (
        <section className="flex flex-col gap-2 rounded-card bg-bg p-4 shadow-card">
          <h2 className="text-[13px] font-semibold text-ink-2">{t("helperProfile.highlights")}</h2>
          <div className="flex flex-wrap gap-2">
            {highlights.map((h) => (
              <span key={h.tag} className="rounded-full bg-brand-bg px-3 py-1.5 text-[13px] font-semibold text-brand-ink">
                {t(`rating.tags.${h.tag as "onTime"}`)} · {h.n}
              </span>
            ))}
          </div>
        </section>
      )}

      {p.categories.length > 0 && (
        <section className="flex flex-col gap-2 rounded-card bg-bg p-4 shadow-card">
          <h2 className="text-[13px] font-semibold text-ink-2">{t("helperProfile.does")}</h2>
          <div className="flex flex-wrap gap-2">
            {p.categories.map((c) => (
              <span key={c} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[13px] font-medium">
                <CategoryIcon id={c} size={14} /> {t(`categoryShort.${c}`)}
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-[17px] font-bold">{t("helperProfile.reviewsTitle", { n: p.ratingCount })}</h2>
        {reviews.length === 0 ? (
          <p className="rounded-card bg-bg p-4 text-[14px] text-ink-2 shadow-card">{t("helperProfile.noReviews")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {reviews.map((r, i) => (
              <li key={i} className="flex flex-col gap-2 rounded-card bg-bg p-4 shadow-card">
                <span className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-0.5" aria-label={t("helperProfile.stars", { n: r.stars })}>
                    {[1, 2, 3, 4, 5].map((s) => (
                      <Star key={s} aria-hidden size={15} className={s <= r.stars ? "fill-brand text-brand" : "text-line"} />
                    ))}
                  </span>
                  <span className="text-[12px] text-ink-2">
                    {r.category ? `${t(`categoryShort.${r.category}`)} · ` : ""}
                    {ubDate(r.at, true)}
                  </span>
                </span>
                {r.tags.length > 0 && (
                  <span className="flex flex-wrap gap-1.5">
                    {r.tags.map((tag) => (
                      <span key={tag} className="rounded-full bg-fill px-2 py-0.5 text-[12px] font-medium text-ink-2">
                        {t(`rating.tags.${tag as "onTime"}`)}
                      </span>
                    ))}
                  </span>
                )}
                {r.note && <p className="text-[15px] leading-relaxed">{r.note}</p>}
                <span className="text-[12px] font-medium text-ink-2">{r.reviewer}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {organizations.map((o) => <Link key={o.id} href={`/orgs/${o.id}`} className="rounded-card bg-bg p-4 font-semibold text-brand-ink shadow-card">{t("org.via", { name: o.name })}</Link>)}
      {!me && (
        <PrimaryBar>
          {/* a direct request: the post form, sent to this helper first */}
          {invitable && invitable.categories.length > 0 && (
            <Link href={`/post?helper=${p.id}`} className={`${btn.primary} w-full`}>
              <Send aria-hidden size={18} /> {t("invite.send")}
            </Link>
          )}
          <SaveButton helperId={p.id} saved={saved} t={t} quiet={Boolean(invitable)} />
        </PrimaryBar>
      )}
    </>
  );
}
