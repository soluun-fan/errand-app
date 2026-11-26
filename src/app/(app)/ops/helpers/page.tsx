import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState, FlowHeader } from "@/components/ui";
import { getLocale, getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { recentlyApproved, reviewQueue } from "@/lib/kyc";
import { CircleCheck } from "lucide-react";
import { titled } from "@/lib/page-title";

export const generateMetadata = titled("ops.title");

/** /ops/helpers — helper applications waiting for review (admins only; others get a 404). */
export default async function OpsHelpersPage() {
  const viewer = await getViewer();
  if (!viewer || viewer.profile.role !== "admin") notFound();
  const [t, locale, queue, approved] = await Promise.all([getT(), getLocale(), reviewQueue(), recentlyApproved()]);
  return (
    <>
      <FlowHeader href="/ops" label={t("common.back")} title={t("ops.title")} />
      {queue.length === 0 ? (
        <EmptyState icon={<CircleCheck aria-hidden size={28} />} title={t("ops.empty")} />
      ) : (
        <ul className="flex flex-col">
          {queue.map((a) => (
            <li key={a.id}>
              <Link href={`/ops/helpers/${a.id}`} className="press flex items-center justify-between gap-3 border-b border-line py-3">
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{a.legalName}</span>
                  <span className="block text-small text-ink-2">
                    {t(a.purpose === "identity" ? "ops.purposeIdentity" : "ops.purposeHelper")} ·{" "}
                    {t("ops.submitted", { when: fmtDateTime(a.submittedAt, locale) })}
                  </span>
                </span>
                <span className="text-body font-semibold">{t("ops.review")} ›</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {/* already approved: open one to send it back for a re-check */}
      {approved.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-title font-bold">{t("ops.recentApproved")}</h2>
          <ul className="flex flex-col">
            {approved.map((a) => (
              <li key={a.id}>
                <Link href={`/ops/helpers/${a.id}`} className="press flex items-center justify-between gap-3 border-b border-line py-3">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{a.legalName}</span>
                    <span className="block text-small text-ink-2">
                      {t(a.purpose === "identity" ? "ops.purposeIdentity" : "ops.purposeHelper")} ·{" "}
                      {t("ops.approvedOn", { when: fmtDateTime(a.decidedAt, locale) })}
                    </span>
                  </span>
                  <span className="text-body text-ink-2">›</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
