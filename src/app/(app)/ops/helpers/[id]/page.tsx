import { notFound } from "next/navigation";
import { CategoryIcon } from "@/components/category-icon";
import { ConfirmSheet } from "@/components/sheet";
import { Card, FlowHeader, PrimaryBar, btn, field, fieldLabel } from "@/components/ui";
import { getLocale, getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { CATEGORIES } from "@/lib/engine";
import { fmtDateTime } from "@/lib/format";
import { applicationForOps } from "@/lib/kyc";
import { KYC_DOCS } from "@/lib/kyc-rules";
import { decideKyc } from "../actions";
import { FileText } from "lucide-react";
import { Ico } from "@/components/icon";

const CHECKS = ["name", "last4", "age", "selfie", "payout"] as const;

/**
 * One application for Ops: documents through 5-minute links, the entered details, a checklist, and
 * Approve / Ask for changes / Reject. Admins only (others get a 404).
 */
export default async function OpsApplicationPage({ params }: PageProps<"/ops/helpers/[id]">) {
  const viewer = await getViewer();
  if (!viewer || viewer.profile.role !== "admin") notFound();
  const { id } = await params;
  const [t, locale, app] = await Promise.all([getT(), getLocale(), applicationForOps(id)]);
  if (!app) notFound();
  const fields = { appId: app.id };
  const note = (
    <label className={fieldLabel}>
      {t("ops.note")}
      <textarea name="note" rows={3} maxLength={500} className={field} />
    </label>
  );
  const row = (label: string, value: string) => (
    <div className="flex justify-between gap-4 text-[15px]">
      <span className="text-ink-2">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );

  return (
    <>
      <FlowHeader href="/ops/helpers" label={t("common.back")} title={app.legalName} />
      <p className="text-sm text-ink-2">{t("ops.submitted", { when: fmtDateTime(app.submittedAt, locale) })}</p>

      <section className="grid grid-cols-2 gap-2">
        {KYC_DOCS.map((d) => {
          const f = app.files[d];
          return (
            <figure key={d} className="flex flex-col gap-1">
              {f ? (
                f.pdf ? (
                  <a href={f.url} target="_blank" rel="noopener noreferrer" className={`${btn.secondary} aspect-[4/3] w-full`}>
                    <Ico as={FileText} /> {t("ops.openPdf")}
                  </a>
                ) : (
                  <a href={f.url} target="_blank" rel="noopener noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element -- 5-minute signed URL */}
                    <img src={f.url} alt={t(`kyc.docs.${d}`)} className="aspect-[4/3] w-full rounded-input bg-fill object-cover" />
                  </a>
                )
              ) : (
                <div className="aspect-[4/3] w-full rounded-input bg-fill" />
              )}
              <figcaption className="text-sm text-ink-2">{t(`kyc.docs.${d}`)}</figcaption>
            </figure>
          );
        })}
      </section>

      <Card>
        <h2 className="font-bold">{t("ops.person")}</h2>
        {row(t("kyc.legalName"), app.legalName)}
        {row(t("kyc.birthDate"), app.birthDate ?? "—")}
        {row(t("kyc.idLast4"), app.idLast4)}
        {row(t("profile.title"), app.profileName || "—")}
      </Card>
      {app.payout && (
        <Card>
          <h2 className="font-bold">{t("ops.payout")}</h2>
          {row(t("kyc.bank"), app.payout.bank)}
          {row(t("kyc.account"), app.payout.accountMasked)}
          {row(t("kyc.holder"), app.payout.holderName)}
        </Card>
      )}
      <Card>
        <h2 className="font-bold">{t("ops.checklist")}</h2>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-[15px]">
          {CHECKS.map((c) => (
            <li key={c}>{t(`ops.checks.${c}`)}</li>
          ))}
        </ul>
      </Card>

      {app.status === "submitted" && (
        <PrimaryBar>
          <ConfirmSheet
            action={decideKyc}
            fields={{ ...fields, decision: "approve" }}
            trigger={t("ops.approve")}
            triggerClass={`${btn.primary} w-full`}
            title={t("ops.approve")}
            body={t("ops.approveBody", { name: app.legalName })}
            confirmLabel={t("ops.approve")}
          >
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-[15px] font-medium text-ink-2">{t("ops.categories")}</legend>
              <div className="flex flex-wrap gap-3">
                {CATEGORIES.map((c) => (
                  <label key={c.id} className="flex min-h-11 items-center gap-2 text-[15px]">
                    <input type="checkbox" name="categories" value={c.id} defaultChecked={app.categories.includes(c.id)} className="h-5 w-5 accent-ink" />
                    <CategoryIcon id={c.id} size={16} /> {t(`categoryShort.${c.id}`)}
                  </label>
                ))}
              </div>
            </fieldset>
          </ConfirmSheet>
          <div className="flex flex-wrap justify-center gap-1">
            <ConfirmSheet
              action={decideKyc}
              fields={{ ...fields, decision: "changes_requested" }}
              trigger={t("ops.changes")}
              triggerClass={btn.text}
              title={t("ops.changes")}
              confirmLabel={t("ops.changes")}
            >
              {note}
            </ConfirmSheet>
            <ConfirmSheet
              action={decideKyc}
              fields={{ ...fields, decision: "reject" }}
              trigger={t("ops.reject")}
              triggerClass={btn.textDanger}
              title={t("ops.reject")}
              body={t("ops.rejectBody", { name: app.legalName })}
              confirmLabel={t("ops.reject")}
              confirmClass={btn.danger}
            >
              {note}
            </ConfirmSheet>
          </div>
        </PrimaryBar>
      )}
    </>
  );
}
