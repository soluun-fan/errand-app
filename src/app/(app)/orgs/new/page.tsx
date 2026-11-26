import { FlowHeader, Note } from "@/components/ui";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { OrgForm } from "./org-form";
import { titled } from "@/lib/page-title";

export const generateMetadata = titled("org.newTitle");

/** /orgs/new — register a company / agency / NGO for specialized work (docs/decisions.md 2026-11-16). */
export default async function NewOrgPage() {
  const viewer = await getViewer();
  if (!viewer) return null;
  const t = await getT();
  return (
    <>
      <FlowHeader href="/profile" label={t("common.back")} title={t("org.newTitle")} />
      <Note tone="info">{t("org.newIntro")}</Note>
      <OrgForm />
    </>
  );
}
