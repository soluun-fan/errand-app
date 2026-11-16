import { Building2, Star } from "lucide-react";
import { notFound } from "next/navigation";
import { CategoryIcon } from "@/components/category-icon";
import { HelperCard } from "@/components/helper-card";
import { FlowHeader, Note } from "@/components/ui";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { fmtMoney } from "@/lib/format";
import { Uuid, parseOr } from "@/lib/input";
import { canManage, members, organization, organizationBalance, publicOrganization } from "@/lib/orgs";
import { ManageMembers } from "./manage";

/**
 * /orgs/[id] — an organisation customers can trust: who it is, what Ops approved it for, its
 * workers and the ratings of jobs done through it. Its owner / managers also manage workers here.
 * Not approved yet → only its own people see it (with the status).
 */
export default async function OrgPage({ params }: PageProps<"/orgs/[id]">) {
  const viewer = await getViewer();
  if (!viewer) return null;
  const id = parseOr(Uuid, (await params).id);
  if (!id) notFound();
  const [t, manage] = await Promise.all([getT(), canManage(id, viewer.profile.id)]);
  const pub = await publicOrganization(id);
  const own = manage ? await organization(id) : null;
  if (!pub && !own) notFound();
  const org = (pub?.org ?? own)!;
  const list = manage ? await members(id) : [];

  return (
    <>
      <FlowHeader href="/helpers" label={t("common.back")} title={t("org.title")} />
      {manage && org.status !== "approved" && <Note tone={org.status === "pending" ? "info" : "bad"}>{t(`org.status.${org.status}`)}{org.reviewNote ? ` — ${org.reviewNote}` : ""}</Note>}
      <section className="flex flex-col items-center gap-3 rounded-card bg-bg p-5 text-center shadow-card">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-bg text-brand-ink">
          <Building2 aria-hidden size={30} />
        </span>
        <h1 className="text-[22px] font-bold tracking-tight">{org.name}</h1>
        <span className="flex flex-wrap justify-center gap-1.5">
          <span className="rounded-full bg-fill px-2.5 py-1 text-[12px] font-semibold text-ink-2">{t(`org.kinds.${org.kind}`)}</span>
          {org.status === "approved" && <span className="rounded-full bg-held-bg px-2.5 py-1 text-[12px] font-bold text-held">{t("org.verified")}</span>}
        </span>
        {pub && (
          <p className="flex items-center gap-1 text-[14px] text-ink-2">
            {pub.rating !== null && (
              <>
                <Star aria-hidden size={14} className="fill-brand text-brand" /> <b className="text-ink">{pub.rating.toFixed(1)}</b> ({pub.ratingCount}) ·
              </>
            )}{" "}
            {t("org.jobsDone", { n: pub.jobsDone })}
          </p>
        )}
        {org.description && <p className="whitespace-pre-line text-left text-[15px] leading-relaxed">{org.description}</p>}
        <span className="flex flex-wrap justify-center gap-2">
          {(org.status === "approved" ? org.categories : org.requestedCategories).map((c) => (
            <span key={c} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[13px] font-medium">
              <CategoryIcon id={c} size={14} /> {t(`categoryShort.${c}`)}
            </span>
          ))}
        </span>
        <p className="text-[12px] text-ink-2">{t("org.paidNote")}</p>
      </section>

      {pub && pub.workers.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-[17px] font-bold">{t("org.workers", { n: pub.workers.length })}</h2>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {pub.workers.map((h) => (
              <li key={h.id} className="min-w-0">
                <HelperCard h={h} t={t} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {manage && <section className="rounded-card bg-held-bg p-4 text-held">
        <h2 className="text-sm">{t("org.balance")}</h2>
        <p className="text-[26px] font-bold tabular-nums">{fmtMoney(await organizationBalance(org.id))}</p>
        <p className="mt-2 text-sm">{t("earnings.withdrawSoon")}</p>
      </section>}
      {manage && org.status === "approved" && <ManageMembers orgId={org.id} kinds={org.categories} members={list} />}
    </>
  );
}
