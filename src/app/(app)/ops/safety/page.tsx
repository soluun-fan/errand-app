import { notFound } from "next/navigation";
import { Card, FlowHeader } from "@/components/ui";
import { getLocale, getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { getControls, recentAudit } from "@/lib/safety";
import { createAdminClient } from "@/lib/supabase/admin";
import { ControlsForm } from "./controls-form";

/** /ops/safety — pause switches, money caps, what's held right now, and the Ops audit log. */
export default async function OpsSafetyPage() {
  const viewer = await getViewer();
  if (!viewer || viewer.profile.role !== "admin") notFound();
  const [t, locale, controls, log, held] = await Promise.all([
    getT(),
    getLocale(),
    getControls(),
    recentAudit(),
    createAdminClient().rpc("account_balance", { p_account: "hold" }),
  ]);
  const { updatedAt, ...c } = controls;
  return (
    <>
      <FlowHeader href="/ops" label={t("common.back")} title={t("opsSafety.title")} />
      <Card>
        <p className="text-sm text-ink-2">{t("opsSafety.heldNow")}</p>
        <p className="text-[28px] font-bold tabular-nums">
          {fmtMoney(Number(held.data ?? 0))} <span className="text-base font-normal text-ink-2">/ {fmtMoney(c.maxTotalHeld)}</span>
        </p>
        <p className="text-sm text-ink-2">{t("opsSafety.updated", { when: fmtDateTime(updatedAt, locale) })}</p>
      </Card>
      <ControlsForm c={c} />
      <section className="flex flex-col gap-2">
        <h2 className="font-bold">{t("opsSafety.log")}</h2>
        {log.length === 0 ? (
          <p className="text-[15px] text-ink-2">{t("opsSafety.logEmpty")}</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {log.map((l) => (
              <li key={l.id} className="flex gap-3 text-sm">
                <span className="w-24 flex-none tabular-nums text-ink-2">{fmtDateTime(l.at, locale)}</span>
                <span>
                  <b>{l.actorName}</b> · {l.action}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
