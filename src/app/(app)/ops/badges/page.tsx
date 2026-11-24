import { notFound } from "next/navigation";
import { InlineAction } from "@/components/inline-action";
import { Card, FlowHeader, Note, btn, field } from "@/components/ui";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { badgeQueue } from "@/lib/badges";
import { decideBadgeAction } from "../actions";
import { Car, IdCard } from "lucide-react";
import { Ico } from "@/components/icon";

/** /ops/badges — check drivers' licences and car registrations (docs/decisions.md 2026-11-18). Admins only. */
export default async function OpsBadgesPage() {
  const viewer = await getViewer();
  if (!viewer || viewer.profile.role !== "admin") notFound();
  const [t, queue] = await Promise.all([getT(), badgeQueue()]);
  return (
    <>
      <FlowHeader href="/ops" label={t("common.back")} title={t("opsBadges.title")} />
      <Note tone="info">{t("opsBadges.help")}</Note>
      {queue.length === 0 && <p className="text-[15px] text-ink-2">{t("opsBadges.none")}</p>}
      {queue.map((b) => (
        <Card key={b.id}>
          <h2 className="font-bold">
            {b.kind === "driver" ? <Ico as={IdCard} /> : <Ico as={Car} />} {b.helperName}
          </h2>
          <p className="text-[15px]">{Object.entries(b.info).map(([k, v]) => `${k}: ${v}`).join(" · ")}</p>
          {b.expiresOn && <p className="text-sm text-ink-2">{t("opsBadges.expires", { date: b.expiresOn })}</p>}
          {b.docUrl && (
            <a href={b.docUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-ink underline">
              {t("opsBadges.openDoc")}
            </a>
          )}
          <div className="grid grid-cols-2 gap-2">
            <InlineAction action={decideBadgeAction} fields={{ id: b.id, approve: "0" }} label={t("opsBadges.reject")} className={`${btn.secondary} w-full`}>
              <input name="note" maxLength={500} placeholder={t("opsBadges.notePh")} className={field} />
            </InlineAction>
            <InlineAction action={decideBadgeAction} fields={{ id: b.id, approve: "1" }} label={t("opsBadges.approve")} className={`${btn.small} w-full`} />
          </div>
        </Card>
      ))}
    </>
  );
}
