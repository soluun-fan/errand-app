import Link from "next/link";
import { CategoryIcon } from "@/components/category-icon";
import { FlowHeader, Note, btn } from "@/components/ui";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { myCertificates, myMemberships } from "@/lib/orgs";
import { CertForm } from "./cert-form";

/**
 * /helper/certificates — specialized work for verified helpers (docs/decisions.md 2026-11-16):
 * a trade certificate Ops checks (plumbing, electrical, cleaning), or work through an organisation.
 * Care work (children, elders) is only through an approved agency.
 */
export default async function CertificatesPage() {
  const viewer = await getViewer();
  if (!viewer) return null;
  const t = await getT();
  if (!viewer.actor.helperApproved) {
    return (
      <>
        <FlowHeader href="/profile" label={t("common.back")} title={t("cert.title")} />
        <Note tone="info">{t("cert.needHelper")}</Note>
        <Link href="/helper/apply" className={`${btn.primary} w-full`}>
          {t("cert.becomeHelper")}
        </Link>
      </>
    );
  }
  const [certs, orgs] = await Promise.all([myCertificates(viewer.profile.id), myMemberships(viewer.profile.id)]);
  const qualified = viewer.actor.qualified ?? [];
  return (
    <>
      <FlowHeader href="/profile" label={t("common.back")} title={t("cert.title")} />
      <Note tone="info">{t("cert.intro")}</Note>

      {qualified.length > 0 && (
        <section className="flex flex-col gap-2 rounded-card bg-bg p-4 shadow-card">
          <h2 className="text-[13px] font-semibold text-ink-2">{t("cert.canTake")}</h2>
          <ul className="flex flex-wrap gap-2">
            {qualified.map((q) => (
              <li key={`${q.category}:${q.orgId ?? "own"}`} className="inline-flex items-center gap-1.5 rounded-full bg-held-bg px-3 py-1.5 text-[13px] font-semibold text-held">
                <CategoryIcon id={q.category} size={14} /> {t(`categoryShort.${q.category}`)} · {q.orgId ? orgs.find((o) => o.orgId === q.orgId)?.orgName ?? t("cert.viaOrg") : t("cert.own")}
              </li>
            ))}
          </ul>
        </section>
      )}

      {certs.length > 0 && (
        <ul className="flex flex-col rounded-card bg-bg shadow-card">
          {certs.map((c) => (
            <li key={c.id} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
              <CategoryIcon id={c.category} tile size={16} />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{t(`categoryShort.${c.category}`)}</span>
                <span className="block truncate text-[13px] text-ink-2">
                  {c.issuer}
                  {c.expiresOn ? ` · ${t("cert.until", { date: c.expiresOn })}` : ""}
                </span>
                {c.reviewNote && <span className="block text-[13px] text-ink-2">{c.reviewNote}</span>}
              </span>
              <span className={`rounded-full px-2.5 py-1 text-[12px] font-bold ${c.status === "approved" ? "bg-held-bg text-held" : c.status === "pending" ? "bg-fill text-ink-2" : "bg-danger/10 text-danger"}`}>
                {t(`cert.status.${c.status}`)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <h2 className="text-[17px] font-bold">{t("cert.add")}</h2>
      <CertForm />
      <p className="text-[14px] text-ink-2">{t("cert.orgHint")}</p>
    </>
  );
}
