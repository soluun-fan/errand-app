import { redirect } from "next/navigation";
import { Card, FlowHeader, Note } from "@/components/ui";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { getSupportSettings } from "@/lib/support";
import { SupportForm } from "./support-form";
import { titled } from "@/lib/page-title";

export const generateMetadata = titled("support.title");

/**
 * /support — Help & contact (2026-11-23): the channels Ops filled in (any may be empty) and
 * "Message our team", which lands in the Ops inbox. For a problem on a task, the task's own
 * "Report a problem" and SOS stay the faster way.
 */
export default async function SupportPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const [t, s] = await Promise.all([getT(), getSupportSettings()]);
  const tel = s.phone?.replace(/[^\d+]/g, "") ?? "";
  return (
    <>
      <FlowHeader href="/profile" label={t("common.back")} title={t("support.title")} />
      <Note tone="info">{t("support.taskHint")}</Note>
      {(s.phone || s.email || s.facebook) && (
        <Card>
          <h2 className="font-bold">{t("support.reach")}</h2>
          {s.hours && <p className="text-small text-ink-2">{s.hours}</p>}
          <ul className="flex flex-col gap-2 text-lead">
            {s.phone && <li>{t("support.phone")}: <a href={`tel:${tel}`} className="font-semibold underline">{s.phone}</a></li>}
            {s.email && <li>{t("support.email")}: <a href={`mailto:${s.email}`} className="font-semibold underline">{s.email}</a></li>}
            {s.facebook && <li><a href={s.facebook} target="_blank" rel="noopener noreferrer" className="font-semibold underline">{t("support.facebook")}</a></li>}
          </ul>
        </Card>
      )}
      <Card>
        <h2 className="font-bold">{t("support.write")}</h2>
        <p className="text-small text-ink-2">{t("support.writeHint")}</p>
        <SupportForm />
      </Card>
    </>
  );
}
