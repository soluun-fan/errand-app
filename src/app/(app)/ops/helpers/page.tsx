import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState, FlowHeader } from "@/components/ui";
import { getLocale, getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { activeHelpers, recentlyApproved, reviewQueue } from "@/lib/kyc";
import { ConfirmSheet } from "@/components/sheet";
import { btn, field, fieldLabel } from "@/components/ui";
import { revokeHelperAction, setComputerAction } from "./actions";
import { InlineAction } from "@/components/inline-action";
import { CircleCheck } from "lucide-react";
import { titled } from "@/lib/page-title";

export const generateMetadata = titled("ops.title");

/** /ops/helpers — helper applications waiting for review (admins only; others get a 404). */
export default async function OpsHelpersPage() {
  const viewer = await getViewer();
  if (!viewer || viewer.profile.role !== "admin") notFound();
  const [t, locale, queue, approved, helpers] = await Promise.all([
    getT(),
    getLocale(),
    reviewQueue(),
    recentlyApproved(),
    activeHelpers(),
  ]);
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
      {/* everyone who can take jobs now and how they got there: switch off accounts nobody checked (2026-11-26) */}
      {helpers.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-title font-bold">{t("ops.allHelpers", { n: helpers.length })}</h2>
          <ul className="flex flex-col">
            {helpers.map((h) => (
              <li key={h.userId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line py-3">
                <span className="min-w-0">
                  <span className="block truncate font-semibold">
                    {h.name}
                    {h.admin && <span className="ml-2 rounded-full bg-fill px-2 py-0.5 text-caption font-semibold text-ink-2">Ops</span>}
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-small text-ink-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-caption font-semibold ${h.via === "id" ? "bg-held-bg text-held" : "bg-warn-bg text-warn"}`}
                    >
                      {t(`ops.via.${h.via}`)}
                    </span>
                    {t("ops.jobsDone", { n: h.jobs })}
                  </span>
                </span>
                <span className="flex items-center gap-1">
                  {/* Ops decides who may work from a computer (2026-11-27): phone check skipped, notifications + location still needed */}
                  <InlineAction
                    action={setComputerAction}
                    fields={{ userId: h.userId, allowed: h.desktopOk ? "0" : "1" }}
                    label={h.desktopOk ? t("ops.computerOff") : t("ops.computerOn")}
                    className={`${btn.text} min-h-11 text-small ${h.desktopOk ? "text-held" : "text-ink-2"}`}
                  />
                  <ConfirmSheet
                    action={revokeHelperAction}
                    fields={{ userId: h.userId }}
                    trigger={t("ops.revoke")}
                    triggerClass={`${btn.text} min-h-11 text-small text-danger`}
                    title={t("ops.revokeTitle", { name: h.name })}
                    body={t("ops.revokeBody")}
                    confirmLabel={t("ops.revoke")}
                    confirmClass={btn.danger}
                  >
                    <label className={fieldLabel}>
                      {t("ops.note")}
                      <textarea name="note" rows={3} maxLength={500} className={field} />
                    </label>
                  </ConfirmSheet>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
