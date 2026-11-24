import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { InlineAction } from "@/components/inline-action";
import { ConfirmSheet } from "@/components/sheet";
import { Card, EmptyState, FlowHeader, btn, field, fieldLabel } from "@/components/ui";
import { getLocale, getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { incidentQueue } from "@/lib/incidents";
import { googlePlaceUrl } from "@/lib/maps";
import { normalizeMnPhone } from "@/lib/phone";
import { acknowledge, resolve } from "../actions";
import { CircleCheck, MapPin, Phone } from "lucide-react";
import { Ico } from "@/components/icon";

/**
 * /ops/incidents — SOS first, then other open reports, then the latest resolved. Admins only.
 * Ops may call the reporter (tel: link, number not printed) and open their SOS position.
 */
export default async function OpsIncidentsPage() {
  const viewer = await getViewer();
  if (!viewer || viewer.profile.role !== "admin") notFound();
  const [t, locale, items] = await Promise.all([getT(), getLocale(), incidentQueue()]);
  return (
    <>
      <FlowHeader href="/ops" label={t("common.back")} title={t("opsIncidents.title")} />
      <AutoRefresh seconds={15} />
      {items.length === 0 ? (
        <EmptyState icon={<CircleCheck aria-hidden size={28} />} title={t("opsIncidents.empty")} />
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((i) => {
            const sos = i.kind === "sos";
            const tel = i.reporter.phone ? normalizeMnPhone(i.reporter.phone) : null;
            return (
              <li key={i.id} id={i.id}>
                <Card className={sos && i.status !== "resolved" ? "border-danger" : i.status === "resolved" ? "opacity-70" : ""}>
                  <div className="flex items-start justify-between gap-3">
                    <p className={`font-bold ${sos ? "text-danger" : ""}`}>
                      {sos ? "🆘 SOS" : t(`safety.kinds.${i.kind}`)}
                      {sos && i.alerts > 1 && <span className="font-normal"> · {t("opsIncidents.presses", { n: i.alerts, when: fmtDateTime(i.lastAlertAt, locale) })}</span>}
                    </p>
                    <span className="rounded-full bg-fill px-2.5 py-0.5 text-sm font-semibold">{t(`opsIncidents.status.${i.status}`)}</span>
                  </div>
                  <p className="text-sm text-ink-2">{fmtDateTime(i.createdAt, locale)}</p>
                  <Link href={`/tasks/${i.dealId}`} className="font-semibold underline underline-offset-4">
                    {i.dealTitle}
                  </Link>
                  <p className="text-[15px]">
                    {t("opsIncidents.from", { name: i.reporter.name, role: t(`opsIncidents.role.${i.reporter.role}`) })}
                    {i.subject && <> · {t("opsIncidents.about", { name: i.subject.name })}</>}
                  </p>
                  {i.note && <p className="whitespace-pre-line rounded-input bg-fill p-2.5 text-[15px]">{i.note}</p>}
                  <div className="flex flex-wrap gap-2">
                    {tel && i.status !== "resolved" && (
                      <a href={`tel:${tel}`} className={btn.secondary}>
                        <Ico as={Phone} size={16} /> {t("opsIncidents.call", { name: i.reporter.name })}
                      </a>
                    )}
                    {i.position && (
                      <a href={googlePlaceUrl(i.position)} target="_blank" rel="noopener noreferrer" className={btn.secondary}>
                        <Ico as={MapPin} size={16} /> {i.position.accuracy !== null ? t("opsIncidents.whereAcc", { m: i.position.accuracy }) : t("opsIncidents.where")}
                      </a>
                    )}
                  </div>
                  {i.status === "resolved" ? (
                    <p className="text-sm text-ink-2">
                      ✓ {i.handledBy}: {i.opsNote}
                    </p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {i.status === "open" && (
                        <InlineAction action={acknowledge} fields={{ id: i.id }} label={t("opsIncidents.ack")} className={`${sos ? btn.danger : btn.small} w-full`} />
                      )}
                      {i.status === "acknowledged" && <p className="text-sm text-ink-2">{t("opsIncidents.handling", { name: i.handledBy ?? "—" })}</p>}
                      <ConfirmSheet
                        action={resolve}
                        fields={{ id: i.id }}
                        trigger={t("opsIncidents.resolve")}
                        triggerClass={`${btn.secondary} w-full`}
                        title={t("opsIncidents.resolveTitle")}
                        confirmLabel={t("opsIncidents.resolve")}
                      >
                        <label className={fieldLabel}>
                          {t("opsIncidents.resolveNote")}
                          <textarea name="note" rows={3} maxLength={1000} className={field} />
                        </label>
                      </ConfirmSheet>
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
