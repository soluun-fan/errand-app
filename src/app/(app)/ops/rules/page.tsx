import { notFound } from "next/navigation";
import { FlowHeader, Note } from "@/components/ui";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { getRules } from "@/lib/rules";
import { RulesForm } from "./rules-form";

/** /ops/rules — timings and limits (docs/decisions.md 2026-11-18 "Rules from the database"). Admins only. */
export default async function OpsRulesPage() {
  const viewer = await getViewer();
  if (!viewer || viewer.profile.role !== "admin") notFound();
  const [t, r] = await Promise.all([getT(), getRules()]);
  return (
    <>
      <FlowHeader href="/ops" label={t("common.back")} title={t("opsRules.title")} />
      <Note tone="info">{t("opsRules.help")}</Note>
      <RulesForm r={r} />
    </>
  );
}
