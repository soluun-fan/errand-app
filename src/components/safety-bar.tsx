"use client";

import { useActionState, useState } from "react";
import { useLocale, useT } from "@/i18n/client";
import { EMERGENCY_NUMBERS, INCIDENT_NOTE_MAX, REPORT_KINDS, REPORT_NOTE_MIN } from "@/lib/incident-rules";
import { fmtDateTime } from "@/lib/format";
import { reportProblem, sendSos } from "@/app/(app)/safety/actions";
import { BottomSheet, SubmitButton, type ActionResult } from "./sheet";
import { Note, btn, chipClass, field, fieldLabel } from "./ui";
import { Ambulance, Phone } from "lucide-react";
import { Ico } from "@/components/icon";

/** Best-effort position for an SOS: never waits more than 6 s and never blocks sending. */
function currentPosition(): Promise<{ lat: number; lng: number; accuracy: number } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 6500);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        clearTimeout(timer);
        resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 30_000 },
    );
  });
}

/**
 * Safety row on a task (docs/decisions.md "Safety pack"): 🆘 (emergency numbers + alert our team
 * with the phone's position) while the two people may meet, and "Report a problem" always.
 * Neither tells the other person.
 */
export function SafetyBar({ dealId, showSos, live }: { dealId: string; showSos: boolean; live: { since: number; acknowledged: boolean } | null }) {
  const t = useT();
  const locale = useLocale();
  const [sosOpen, setSosOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sosError, setSosError] = useState<string | null>(null);
  const [kind, setKind] = useState("");
  const [report, reportAction] = useActionState<ActionResult, FormData>(reportProblem, {});

  async function alertTeam() {
    setSending(true);
    setSosError(null);
    try {
      const r = await sendSos(dealId, await currentPosition());
      if ("error" in r) setSosError(r.error);
      else setSent(true);
    } catch {
      setSosError(t("safety.sosFailed"));
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="flex flex-col gap-2" aria-label={t("safety.title")}>
      {live && (
        <Note tone="bad">
          {live.acknowledged ? t("safety.liveAck") : t("safety.liveSent", { when: fmtDateTime(live.since, locale) })}
        </Note>
      )}
      <div className="flex items-center gap-2">
        {showSos && (
          <button type="button" onClick={() => setSosOpen(true)} className={`${btn.secondary} flex-1 bg-danger-bg text-danger`}>
            🆘 {t("safety.sos")}
          </button>
        )}
        <button type="button" onClick={() => setReportOpen(true)} className={`${btn.text} ${showSos ? "" : "self-start"}`}>
          {t("safety.report")}
        </button>
      </div>

      <BottomSheet open={sosOpen} onClose={() => setSosOpen(false)} title={t("safety.sosTitle")}>
        <p className="text-[16px]">{t("safety.sosLead")}</p>
        <div className="grid grid-cols-2 gap-2">
          <a href={`tel:${EMERGENCY_NUMBERS.police}`} className={`${btn.danger} w-full`}>
            <Ico as={Phone} /> {t("safety.police", { n: EMERGENCY_NUMBERS.police })}
          </a>
          <a href={`tel:${EMERGENCY_NUMBERS.ambulance}`} className={`${btn.danger} w-full`}>
            <Ico as={Ambulance} /> {t("safety.ambulance", { n: EMERGENCY_NUMBERS.ambulance })}
          </a>
        </div>
        <hr className="border-line" />
        {sent ? (
          <Note tone="held">{t("safety.sosSent")}</Note>
        ) : (
          <>
            <p className="text-[15px] text-ink-2">{t("safety.alertLead")}</p>
            {sosError && (
              <p role="alert" className="text-sm text-danger">
                {sosError}
              </p>
            )}
            <button type="button" disabled={sending} aria-busy={sending} onClick={alertTeam} className={`${btn.primary} w-full`}>
              {sending ? t("safety.sending") : t("safety.alertTeam")}
            </button>
          </>
        )}
        <p className="text-sm text-ink-2">{t("safety.notTold")}</p>
        <button type="button" className={`${btn.text} w-full`} onClick={() => setSosOpen(false)}>
          {t("common.close")}
        </button>
      </BottomSheet>

      <BottomSheet open={reportOpen} onClose={() => setReportOpen(false)} title={t("safety.reportTitle")}>
        {report.done ? (
          <>
            <Note tone="held">{t("safety.reportSent")}</Note>
            <button type="button" className={`${btn.secondary} w-full`} onClick={() => setReportOpen(false)}>
              {t("common.close")}
            </button>
          </>
        ) : (
          <form action={reportAction} className="flex flex-col gap-4">
            <input type="hidden" name="dealId" value={dealId} />
            <input type="hidden" name="kind" value={kind} />
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-[15px] font-medium text-ink-2">{t("safety.whatHappened")}</legend>
              <div className="flex flex-wrap gap-2">
                {REPORT_KINDS.map((k) => (
                  <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={chipClass(kind === k)}>
                    {t(`safety.kinds.${k}`)}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className={fieldLabel}>
              {t("safety.describe")}
              <textarea name="note" rows={4} minLength={REPORT_NOTE_MIN} maxLength={INCIDENT_NOTE_MAX} className={field} />
            </label>
            <p className="text-sm text-ink-2">{t("safety.reportHelp")}</p>
            {report.error && (
              <p role="alert" className="text-sm text-danger">
                {report.error}
              </p>
            )}
            <SubmitButton className={`${btn.primary} w-full`}>{t("safety.sendReport")}</SubmitButton>
            <button type="button" className={`${btn.text} w-full`} onClick={() => setReportOpen(false)}>
              {t("common.cancel")}
            </button>
          </form>
        )}
      </BottomSheet>
    </section>
  );
}
