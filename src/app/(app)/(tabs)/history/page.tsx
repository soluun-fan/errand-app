import Link from "next/link";
import { DealCard } from "@/components/deal-card";
import { EmptyState, SegmentedLinks, btn } from "@/components/ui";
import { getLocale, getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { listMyJobs, listMyTasks } from "@/lib/deals/queries";
import { getMode } from "@/lib/mode";

const CLOSED = ["released", "refunded", "cancelled", "expired"];

/** Түүх — skeleton C (DESIGN §5.12): Идэвхтэй · Дууссан · SafePay. Helper mode lists your jobs. */
export default async function HistoryPage({ searchParams }: PageProps<"/history">) {
  const viewer = await getViewer();
  if (!viewer) return null;
  const [t, locale, mode, sp] = await Promise.all([getT(), getLocale(), getMode(), searchParams]);
  const tab = sp.tab === "done" || sp.tab === "safepay" ? sp.tab : "active";

  const deals =
    mode === "helper" ? await listMyJobs(viewer.profile.id) : (await listMyTasks(viewer.profile.id)).map((x) => x.deal);
  const shown = tab === "safepay" ? [] : deals.filter((d) => (tab === "done" ? CLOSED.includes(d.status) : !CLOSED.includes(d.status)));

  return (
    <>
      <h1 className="pt-2 text-[28px] font-bold">{t("history.title")}</h1>
      <SegmentedLinks
        current={tab}
        items={[
          { key: "active", href: "/history", label: t("history.active") },
          { key: "done", href: "/history?tab=done", label: t("history.done") },
          { key: "safepay", href: "/history?tab=safepay", label: t("history.safepay") },
        ]}
      />
      {shown.length ? (
        <div className="flex flex-col">
          {shown.map((d) => (
            <DealCard
              key={d.id}
              deal={d}
              t={t}
              locale={locale}
              row
              rowAction={
                mode === "customer" && tab === "done" ? (
                  <Link href={`/post?again=${d.id}`} className={btn.secondary}>
                    ↻ {t("deal.postAgain")}
                  </Link>
                ) : undefined
              }
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={tab === "safepay" ? "🛡️" : "🧾"}
          title={t(tab === "active" ? "history.emptyActive" : tab === "done" ? "history.emptyDone" : "history.emptySafepay")}
          action={
            mode === "customer" && tab !== "safepay" ? (
              <Link href="/post" className={btn.small}>
                {t("deal.postTask")}
              </Link>
            ) : undefined
          }
        />
      )}
    </>
  );
}
