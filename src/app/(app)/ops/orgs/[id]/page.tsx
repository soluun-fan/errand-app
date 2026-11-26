import { notFound } from "next/navigation";
import { Card, FlowHeader, Note } from "@/components/ui";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { Uuid, parseOr } from "@/lib/input";
import { members, orgForOps } from "@/lib/orgs";
import { DecideOrg } from "./decide";
import { titled } from "@/lib/page-title";

export const generateMetadata = titled("opsOrgs.title");

/** /ops/orgs/[id] — check the registration certificate and payout account, then decide. */
export default async function OpsOrgPage({ params }: PageProps<"/ops/orgs/[id]">) {
  const viewer = await getViewer();
  if (!viewer || viewer.profile.role !== "admin") notFound();
  const id = parseOr(Uuid, (await params).id);
  if (!id) notFound();
  const [t, o] = await Promise.all([getT(), orgForOps(id)]);
  if (!o) notFound();
  const staff = await members(id);
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between gap-4 text-body">
      <span className="text-ink-2">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
  return (
    <>
      <FlowHeader href="/ops/orgs" label={t("common.back")} title={o.name} />
      <Note tone={o.status === "approved" ? "held" : o.status === "pending" ? "info" : "bad"}>{t(`org.statusShort.${o.status}`)}</Note>
      <Card>
        {row(t("org.regNumber"), o.regNumber)}
        {row(t("org.kind"), t(`org.kinds.${o.kind}`))}
        {row(t("opsOrgs.owner"), o.ownerName)}
        {row(t("org.area"), o.area ?? "—")}
        {row(t("org.payout"), o.payout ? `${o.payout.bank} ••${o.payout.last4} · ${o.payout.holder}` : "—")}
        {o.description && <p className="whitespace-pre-line text-small text-ink-2">{o.description}</p>}
        {o.docUrl ? (
          <a href={o.docUrl} target="_blank" rel="noreferrer" className="font-semibold text-brand-ink underline underline-offset-2">
            {t("opsOrgs.openDoc")}
          </a>
        ) : (
          <p className="text-small text-danger">{t("opsOrgs.noDoc")}</p>
        )}
        <p className="text-meta text-ink-2">{t("opsOrgs.checkHint")}</p>
      </Card>
      <DecideOrg id={o.id} requested={o.requestedCategories} approved={o.categories} />
      {staff.length > 0 && (
        <Card>
          <h2 className="font-bold">{t("org.workers", { n: staff.length })}</h2>
          {staff.map((m) => <div key={m.helperId}>{row(m.name, `${t(`org.roles.${m.role}`)} · ${m.status === "active" ? m.categories.map((c) => t(`categoryShort.${c}`)).join(", ") : t("org.manage.waiting")}`)}</div>)}
        </Card>
      )}
    </>
  );
}
