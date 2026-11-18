"use client";

import { useActionState, useState } from "react";
import { SubmitButton, type ActionResult } from "@/components/sheet";
import { Note, field, fieldLabel } from "@/components/ui";
import { useT } from "@/i18n/client";
import type { PlatformRules } from "@/lib/rules";
import { saveRules } from "../actions";

type NumKey = Exclude<keyof PlatformRules, "dispatchWaves" | "payMode">;

const GROUPS: { title: "money" | "search" | "backOut" | "care"; fields: [NumKey, "min" | "h" | "days" | "sec" | "people" | "hour"][] }[] = [
  { title: "money", fields: [["paymentWindowMinutes", "min"], ["checkHours", "h"]] },
  {
    title: "search",
    fields: [
      ["nowMatchWindowMinutes", "min"],
      ["scheduleMatchWindowHours", "h"],
      ["applicationMinutes", "min"],
      ["autoPickMinutes", "min"],
      ["inviteMinutes", "min"],
      ["inviteMinutesScheduled", "min"],
      ["maxApplicants", "people"],
    ],
  },
  { title: "backOut", fields: [["backOutGraceMinutes", "min"], ["pauseDaysFirst", "days"], ["pauseDaysSecond", "days"], ["pauseDaysMore", "days"], ["carePauseDays", "days"]] },
  { title: "care", fields: [["careDayStartHour", "hour"], ["careDayEndHour", "hour"], ["careMaxMinutes", "min"], ["careCallMinSeconds", "sec"]] },
];

/** Timings and limits Ops can tune. New tasks use them; tasks already posted keep theirs. */
export function RulesForm({ r }: { r: PlatformRules }) {
  const t = useT();
  const [state, action] = useActionState<ActionResult, FormData>(saveRules, {});
  const [waves, setWaves] = useState(r.dispatchWaves);
  return (
    <form action={action} className="flex flex-col gap-6">
      {GROUPS.map((g) => (
        <section key={g.title} className="flex flex-col gap-3">
          <h2 className="font-bold">{t(`opsRules.g.${g.title}`)}</h2>
          <div className="grid grid-cols-2 gap-3">
            {g.fields.map(([k, unit]) => (
              <label key={k} className={fieldLabel}>
                {t(`opsRules.f.${k}`)}
                <span className="flex items-center gap-2">
                  <input name={k} inputMode="numeric" defaultValue={r[k]} className={field} />
                  <span className="w-10 text-sm text-ink-2">{t(`opsRules.u.${unit}`)}</span>
                </span>
              </label>
            ))}
          </div>
        </section>
      ))}

      <section className="flex flex-col gap-3">
        <h2 className="font-bold">{t("opsRules.g.waves")}</h2>
        <p className="text-sm text-ink-2">{t("opsRules.wavesHelp")}</p>
        <input type="hidden" name="waveCount" value={waves.length} />
        {waves.map((w, i) => (
          <div key={i} className="grid grid-cols-[2rem_1fr_1fr_1fr] items-end gap-2">
            <span className="pb-3 text-sm font-semibold text-ink-2">{i + 1}</span>
            <label className={fieldLabel}>
              {t("opsRules.waveKm")}
              <input name={`waveKm${i}`} inputMode="numeric" defaultValue={w.radiusKm} className={field} />
            </label>
            <label className={fieldLabel}>
              {t("opsRules.waveMax")}
              <input name={`waveMax${i}`} inputMode="numeric" defaultValue={w.max} className={field} />
            </label>
            <label className={fieldLabel}>
              {t("opsRules.waveSec")}
              <input name={`waveSec${i}`} inputMode="numeric" defaultValue={w.seconds} className={field} />
            </label>
          </div>
        ))}
        <div className="flex gap-3">
          {waves.length < 8 && (
            <button type="button" className="text-[14px] font-semibold text-brand-ink underline" onClick={() => setWaves([...waves, { radiusKm: 1000, max: 100, seconds: 0 }])}>
              {t("opsRules.waveAdd")}
            </button>
          )}
          {waves.length > 1 && (
            <button type="button" className="text-[14px] font-semibold text-danger underline" onClick={() => setWaves(waves.slice(0, -1))}>
              {t("opsRules.waveRemove")}
            </button>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-bold">{t("opsRules.g.pay")}</h2>
        <label className={fieldLabel}>
          {t("opsRules.payMode")}
          <select name="payMode" defaultValue={r.payMode} className={field}>
            <option value="direct">{t("opsRules.payDirect")}</option>
            <option value="held">{t("opsRules.payHeld")}</option>
          </select>
        </label>
        <p className="text-sm text-ink-2">{t("opsRules.payHelp")}</p>
      </section>

      <Note tone="info">{t("opsRules.appliesNew")}</Note>
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      {state.done && <p className="text-sm text-held">{t("opsRules.saved")}</p>}
      <SubmitButton className="min-h-12 rounded-input bg-ink px-4 font-bold text-white">{t("opsRules.save")}</SubmitButton>
    </form>
  );
}
