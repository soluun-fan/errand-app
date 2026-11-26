import { notFound } from "next/navigation";
import { Card, FlowHeader, Note } from "@/components/ui";
import { getLocale, getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { getSupportSettings, supportInbox } from "@/lib/support";
import { SupportDone, SupportSettingsForm } from "./support-forms";
import { titled } from "@/lib/page-title";

export const generateMetadata = titled("opsSupport.title");

/** /ops/support — the contact channels people see, and the "Message our team" inbox (2026-11-23). */
export default async function OpsSupportPage() {
  const viewer = await getViewer();
  if (!viewer || viewer.profile.role !== "admin") notFound();
  const [t, locale, settings, inbox] = await Promise.all([getT(), getLocale(), getSupportSettings(), supportInbox()]);
  return (
    <>
      <FlowHeader href="/ops" label={t("common.back")} title={t("opsSupport.title")} />
      <Card>
        <h2 className="font-bold">{t("opsSupport.channels")}</h2>
        <p className="text-small text-ink-2">{t("opsSupport.channelsHelp")}</p>
        <SupportSettingsForm s={settings} />
      </Card>
      <h2 className="font-bold">{t("opsSupport.inbox")}</h2>
      {inbox.length === 0 && <p className="text-body text-ink-2">{t("opsSupport.none")}</p>}
      {inbox.map((r) => (
        <Card key={r.id}>
          <p className="text-caption font-semibold uppercase text-ink-2">
            {t(`support.topics.${r.topic}`)} · {fmtDateTime(r.at, locale)}{r.status === "done" ? ` · ${t("opsSupport.done")}` : ""}
          </p>
          <p className="text-body font-semibold">{r.name}{r.phone ? ` · +${r.phone.replace(/^\+/, "")}` : ""}</p>
          <p className="whitespace-pre-wrap text-body">{r.message}</p>
          {r.opsNote && <Note tone="grey">{r.opsNote}</Note>}
          {r.status === "open" && <SupportDone id={r.id} />}
        </Card>
      ))}
    </>
  );
}
