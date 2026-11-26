import { FlowHeader, Note } from "@/components/ui";
import { InlineAction } from "@/components/inline-action";
import { LegalDoc } from "@/components/legal-doc";
import { btn } from "@/components/ui";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { legalParams } from "@/lib/legal-params";
import { LEGAL_VERSIONS } from "@/lib/legal-rules";
import { acceptHelperTerms } from "./actions";
import { titled } from "@/lib/page-title";

export const generateMetadata = titled("legal.helperTitle");

const KEYS = ["independent", "eligibility", "price", "earnings", "work", "backout", "conditions", "disputes", "taxes", "safety", "ending"] as const;

/**
 * /helper-terms — the Helper service agreement (owner's V1 Master Spec A3, A4, A7): helpers are
 * independent providers paid per task. A DRAFT until the lawyer reviews it. A helper who accepted an
 * older version accepts the new one here.
 */
export default async function HelperTermsPage() {
  const [t, viewer] = await Promise.all([getT(), getViewer()]);
  const p = await legalParams(t);
  const p0 = viewer?.profile;
  const needsAccept = Boolean(p0 && (p0.role === "helper" || p0.helper_status) && p0.helper_terms_version !== LEGAL_VERSIONS.helper);
  return (
    <>
      <FlowHeader href="/" label={t("common.back")} />
      <LegalDoc t={t} title={t("legal.helperTitle")} version={LEGAL_VERSIONS.helper} sections={KEYS.map((k) => ({ title: t(`legal.helper.${k}.t`), body: t(`legal.helper.${k}.b`, p) }))} />
      {needsAccept && (
        <section className="flex flex-col gap-3 rounded-card border-2 border-brand bg-bg p-4 shadow-card">
          <Note tone="info">{t("legal.helperAcceptNote")}</Note>
          <InlineAction action={acceptHelperTerms} fields={{}} label={t("legal.helperAccept")} className={`${btn.primary} w-full`} done={<Note tone="held">{t("legal.helperAccepted")}</Note>} />
        </section>
      )}
    </>
  );
}
