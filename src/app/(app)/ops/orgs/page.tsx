import Link from "next/link";
import { notFound } from "next/navigation";
import { FlowHeader } from "@/components/ui";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { orgQueue } from "@/lib/orgs";
import { titled } from "@/lib/page-title";

export const generateMetadata = titled("opsOrgs.title");

/** /ops/orgs — organisations to review (pending first), then all others. Admins only. */
export default async function OpsOrgsPage() {
  const viewer = await getViewer();
  if (!viewer || viewer.profile.role !== "admin") notFound();
  const [t, list] = await Promise.all([getT(), orgQueue()]);
  return (
    <>
      <FlowHeader href="/ops" label={t("common.back")} title={t("opsOrgs.title")} />
      {list.length === 0 && <p className="text-body text-ink-2">{t("opsOrgs.empty")}</p>}
      <ul className="flex flex-col rounded-card bg-bg shadow-card">
        {list.map((o) => (
          <li key={o.id}>
            <Link href={`/ops/orgs/${o.id}`} className="press flex items-center gap-3 border-b border-line px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{o.name}</span>
                <span className="block text-meta text-ink-2">
                  {o.regNumber} · {t(`org.kinds.${o.kind}`)} · {o.requestedCategories.map((c) => t(`categoryShort.${c}`)).join(", ")}
                </span>
              </span>
              <span className={`rounded-full px-2.5 py-1 text-caption font-bold ${o.status === "pending" ? "bg-brand text-white" : o.status === "approved" ? "bg-held-bg text-held" : "bg-fill text-ink-2"}`}>{t(`org.statusShort.${o.status}`)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
