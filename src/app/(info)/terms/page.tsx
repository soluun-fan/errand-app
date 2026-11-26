import { FlowHeader } from "@/components/ui";
import { LegalDoc } from "@/components/legal-doc";
import { getT } from "@/i18n/server";
import { legalParams } from "@/lib/legal-params";
import { LEGAL_VERSIONS } from "@/lib/legal-rules";
import { titled } from "@/lib/page-title";

export const generateMetadata = titled("legal.termsTitle");

const KEYS = ["service", "account", "posting", "price", "payment", "shopping", "check", "cancel", "disputes", "conduct", "liability", "changes"] as const;

/**
 * /terms — Terms of service for customers (owner's V1 Master Spec A1, A7): the customer buys the
 * errand service from us. A DRAFT until the lawyer reviews it; amounts are the live settings.
 */
export default async function TermsPage() {
  const t = await getT();
  const p = await legalParams(t);
  return (
    <>
      <FlowHeader href="/" label={t("common.back")} />
      <LegalDoc t={t} title={t("legal.termsTitle")} version={LEGAL_VERSIONS.terms} sections={KEYS.map((k) => ({ title: t(`legal.terms.${k}.t`), body: t(`legal.terms.${k}.b`, p) }))} />
    </>
  );
}
