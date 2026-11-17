import { notFound } from "next/navigation";
import { CategoryIcon } from "@/components/category-icon";
import { FlowHeader, Note } from "@/components/ui";
import { categoryTrust } from "@/lib/engine";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { certificateQueue } from "@/lib/orgs";
import { DecideCert } from "./decide-cert";

/** /ops/certificates — trade certificates waiting for a check (oldest first). Admins only. */
export default async function OpsCertificatesPage() {
  const viewer = await getViewer();
  if (!viewer || viewer.profile.role !== "admin") notFound();
  const [t, queue] = await Promise.all([getT(), certificateQueue()]);
  return (
    <>
      <FlowHeader href="/ops" label={t("common.back")} title={t("opsCerts.title")} />
      {queue.length === 0 && <p className="text-[15px] text-ink-2">{t("opsCerts.empty")}</p>}
      {queue.map((c) => (
        <section key={c.id} className="flex flex-col gap-3 rounded-card bg-bg p-4 shadow-card">
          <div className="flex items-center gap-3">
            <CategoryIcon id={c.category} tile size={16} />
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">
                {c.helperName} · {t(`categoryShort.${c.category}`)}
              </span>
              <span className="block text-[13px] text-ink-2">
                {c.issuer}
                {c.number ? ` · №${c.number}` : ""}
                {c.expiresOn ? ` · ${t("cert.until", { date: c.expiresOn })}` : ""}
              </span>
            </span>
          </div>
          {c.docUrl && (
            <a href={c.docUrl} target="_blank" rel="noreferrer" className="font-semibold text-brand-ink underline underline-offset-2">
              {t("opsOrgs.openDoc")}
            </a>
          )}
          {categoryTrust(c.category) === "care" && <Note tone="warn">{t("opsCerts.careCheck")}</Note>}
          {c.firstAid && <Note tone="info">🩹 {t("opsCerts.firstAidClaimed")}</Note>}
          <DecideCert id={c.id} />
        </section>
      ))}
    </>
  );
}
