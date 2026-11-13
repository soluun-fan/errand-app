import Link from "next/link";
import { redirect } from "next/navigation";
import { DealCard } from "@/components/deal-card";
import { MapPill, MapSlot } from "@/components/map-slot";
import { Avatar, chipClass } from "@/components/ui";
import { getLocale, getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { listMyTasks } from "@/lib/deals/queries";
import { getMode } from "@/lib/mode";
import { CATEGORY_ICON } from "@/lib/labels";
import { DraftChip } from "./draft-chip";

const TILES = ["shop", "carry", "queue", "deliver", "repair"] as const;

/** Home — skeleton A (DESIGN §5.1, ref 01). */
export default async function Home() {
  const viewer = await getViewer();
  if (!viewer) return null;
  if ((await getMode()) === "helper") redirect("/jobs");
  const [t, locale, all] = await Promise.all([getT(), getLocale(), listMyTasks(viewer.profile.id)]);
  const closed = ["released", "refunded", "cancelled", "expired"];
  const active = all.filter((x) => !closed.includes(x.deal.status));
  const everCompleted = all.some((x) => x.deal.status === "released");
  const repeat = [...new Map(all.filter((x) => x.deal.status === "released").map((x) => [x.deal.title, x.deal])).values()].slice(0, 3);

  return (
    <>
      <div className="-mx-5 -mt-2">
        <MapSlot>
          <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4">
            <span className="flex items-center gap-2 rounded-full bg-bg/95 py-1.5 pl-1.5 pr-3 font-semibold shadow-float">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">T</span>
              {t("home.city")}
            </span>
            <Link href="/profile" aria-label={t("home.profile")} className="rounded-full shadow-float">
              <Avatar name={viewer.profile.name || "?"} size={44} />
            </Link>
          </div>
          <div className="absolute inset-x-0 top-[38%] flex justify-center px-6">
            <Link href="/profile">
              <MapPill>
                <span aria-hidden>📍</span> {viewer.profile.area || t("home.area")} ›
              </MapPill>
            </Link>
          </div>
        </MapSlot>
      </div>

      {/* sheet over the map */}
      <section className="-mx-5 -mt-8 flex flex-col gap-4 rounded-t-sheet bg-bg px-5 pt-3">
        <div aria-hidden className="mx-auto h-1 w-10 rounded-full bg-line" />

        <form action="/post" className="flex min-h-14 items-center gap-2 rounded-full border border-line bg-bg pl-4 pr-1.5 shadow-float">
          <span aria-hidden className="text-lg">
            🔍
          </span>
          <label htmlFor="q" className="sr-only">
            {t("home.search")}
          </label>
          <input id="q" name="title" maxLength={40} placeholder={t("home.search")} className="min-w-0 flex-1 bg-transparent text-[18px] outline-none placeholder:text-ink-2" />
          <button aria-label={t("home.heroGo")} className="flex h-11 w-11 items-center justify-center rounded-full text-xl hover:bg-fill">
            →
          </button>
        </form>

        <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
          <DraftChip />
          {repeat.map((d) => (
            <Link key={d.id} href={`/post?cat=${d.category}&title=${encodeURIComponent(d.title)}`} className={chipClass(false)}>
              <span aria-hidden>{CATEGORY_ICON[d.category]}</span>
              {d.title}
            </Link>
          ))}
        </div>

        {active.map((x) => (
          <DealCard key={x.deal.id} deal={x.deal} offerCount={x.offerCount} t={t} locale={locale} />
        ))}

        <div className="grid grid-cols-4 gap-2.5">
          {TILES.map((c) => (
            <Link key={c} href={`/post?cat=${c}`} className="press flex aspect-[0.86] flex-col items-center justify-center gap-1.5 rounded-tile bg-fill p-2">
              <span aria-hidden className="text-[34px] leading-none">
                {CATEGORY_ICON[c]}
              </span>
              <span className="text-center text-[13px] font-medium leading-tight">{t(`categoryShort.${c}`)}</span>
            </Link>
          ))}
          <Link href="/safepay" className="press flex aspect-[0.86] flex-col items-center justify-center gap-1.5 rounded-tile bg-fill p-2">
            <span aria-hidden className="text-[34px] leading-none">
              🛡️
            </span>
            <span className="text-[13px] font-medium">{t("categoryShort.safepay")}</span>
          </Link>
          <Link href="/post" className="press flex aspect-[0.86] flex-col items-center justify-center gap-1.5 rounded-tile border border-line p-2">
            <span aria-hidden className="text-[28px] leading-none">
              ⋯
            </span>
            <span className="text-[13px] font-medium">{t("home.all")}</span>
          </Link>
        </div>

        <Link href="/help" className="flex items-center gap-3 rounded-card bg-held-bg p-4 text-held">
          <span aria-hidden className="text-2xl">
            🔒
          </span>
          <span className="text-[15px]">
            {t("home.trust")} <span className="font-semibold underline underline-offset-2">{t("home.howItWorks")}</span>
          </span>
        </Link>

        {!everCompleted && (
          <section className="-mx-5 flex snap-x gap-3 overflow-x-auto px-5 pb-1">
            {([1, 2, 3] as const).map((n) => (
              <div key={n} className="w-64 flex-none snap-start rounded-card border border-line p-4">
                <p className="font-semibold">{t(`home.explainer${n}Title`)}</p>
                <p className="mt-1 text-[15px] text-ink-2">{t(`home.explainer${n}Body`)}</p>
              </div>
            ))}
          </section>
        )}
      </section>
    </>
  );
}
