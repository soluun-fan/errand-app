import { notFound } from "next/navigation";
import { Card, FlowHeader } from "@/components/ui";
import { getLocale, getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { getControls, recentAudit } from "@/lib/safety";
import { createAdminClient } from "@/lib/supabase/admin";
import { ControlsForm } from "./controls-form";

/** /ops/safety — pause switches, money caps, what's held right now, and the Ops audit log. */
/** A logged action in words ("payout.added" → "added a bank account"); unknown ones show their code. */
const ACTIONS = new Set(["badge_approve", "badge_reject", "category_on", "category_off", "certificate_approve", "certificate_reject", "content_cover_set", "content_cover_clear", "content_workPhoto_hide", "controls_update", "incident_acknowledge", "incident_resolve", "keywords_update", "org_invite", "org_remove", "org_approved", "org_rejected", "org_suspended", "payments_unpaidResolved", "payout_added", "payout_changed", "payout_checked", "payout_bank_check_recorded", "marks_void", "marks_lift_pause", "support_settings", "support_done", "pricing_update", "pricing_kindMin", "quick_start_create", "quick_start_update", "quick_start_delete", "rules_update", "withdrawal_sent", "withdrawal_failed", "errors_resolve", "account_closed", "account_paused", "account_pause_lifted"] as const);
type ActionKey = typeof ACTIONS extends Set<infer K> ? K : never;

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
  const actionLabel = (code: string) => {
    const key = code.replace(/\./g, "_");
    return (ACTIONS as Set<string>).has(key) ? t(`opsSafety.act.${key as ActionKey}`) : code;
  };
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
                  <b>{l.actorName}</b> · {actionLabel(l.action)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
