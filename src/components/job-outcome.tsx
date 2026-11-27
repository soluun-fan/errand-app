import { CircleCheckBig, Hourglass, PartyPopper, ShieldAlert, Wallet } from "lucide-react";
import Link from "next/link";
import type { Locale, T } from "@/i18n";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { Countdown } from "./countdown";
import { btn } from "./ui";

export type ReleasedHow = "confirmed" | "auto" | "ops" | null;

/**
 * The helper's finished job, impossible to miss (2026-11-27, owner: "i cant tell if the person
 * approved or not"): a big card with the money, a three-step tracker — done · customer checking ·
 * in Earnings — and, once paid, who approved it and when.
 */
export function JobOutcome({
  status,
  checkUntil,
  serverNow,
  amount,
  how,
  releasedAt,
  t,
  locale,
}: {
  status: "check" | "released" | "disputed";
  checkUntil: number | null;
  serverNow: number;
  /** What the helper receives: fee plus any items repaid. */
  amount: number;
  how: ReleasedHow;
  releasedAt: number | null;
  t: T;
  locale: Locale;
}) {
  if (status === "disputed") {
    return (
      <section className="flex flex-col gap-2 rounded-card border-2 border-warn bg-warn-bg p-5 text-warn shadow-card" aria-live="polite">
        <ShieldAlert aria-hidden size={32} />
        <h2 className="text-title-lg font-bold">{t("outcome.disputedTitle")}</h2>
        <p className="text-body">{t("outcome.disputedBody", { amount: fmtMoney(amount) })}</p>
      </section>
    );
  }
  const paid = status === "released";
  const steps: { label: string; state: "done" | "now" | "next"; sub?: React.ReactNode }[] = [
    { label: t("outcome.stepDone"), state: "done" },
    {
      label: t(paid ? "outcome.stepChecked" : "outcome.stepChecking"),
      state: paid ? "done" : "now",
      sub:
        !paid && checkUntil !== null ? (
          <Countdown until={checkUntil} serverNow={serverNow} template={t("outcome.autoIn")} />
        ) : paid && releasedAt !== null ? (
          t(how === "auto" ? "outcome.howAuto" : how === "ops" ? "outcome.howOps" : "outcome.howConfirmed", {
            time: fmtDateTime(releasedAt, locale),
          })
        ) : undefined,
    },
    { label: t(paid ? "outcome.stepPaidDone" : "outcome.stepPaid"), state: paid ? "done" : "next" },
  ];
  return (
    <section
      aria-live="polite"
      className={`flex flex-col gap-4 rounded-card p-5 shadow-card ${paid ? "bg-held text-white" : "border-2 border-held bg-held-bg text-held"}`}
    >
      <div className="flex items-start gap-3">
        <span aria-hidden className={`flex h-14 w-14 flex-none items-center justify-center rounded-full ${paid ? "bg-white/20" : "bg-bg"}`}>
          {paid ? <CircleCheckBig size={30} /> : <PartyPopper size={30} />}
        </span>
        <div className="min-w-0">
          <h2 className="text-title-lg font-bold leading-tight">{t(paid ? "outcome.paidTitle" : "outcome.doneTitle")}</h2>
          <p className={`text-body ${paid ? "text-white/90" : ""}`}>{t(paid ? "outcome.paidBody" : "outcome.doneBody")}</p>
        </div>
      </div>
      <p className="text-display-sm font-bold tabular-nums">
        +{fmtMoney(amount)}
        <span className={`ml-2 align-middle text-small font-semibold ${paid ? "text-white/85" : ""}`}>
          {t(paid ? "outcome.inEarnings" : "outcome.onTheWay")}
        </span>
      </p>
      <ol className="flex flex-col gap-2.5">
        {steps.map((s) => (
          <li key={s.label} className="flex items-start gap-3">
            <span
              aria-hidden
              className={`mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full text-caption font-bold ${
                s.state === "done"
                  ? paid
                    ? "bg-white text-held"
                    : "bg-held text-white"
                  : s.state === "now"
                    ? "bg-bg text-held ring-2 ring-held"
                    : "bg-white/40 text-held/60"
              }`}
            >
              {s.state === "done" ? "✓" : s.state === "now" ? <Hourglass size={13} /> : ""}
            </span>
            <span className="min-w-0">
              <span className={`block font-semibold ${s.state === "next" ? "opacity-60" : ""}`}>{s.label}</span>
              {s.sub && <span className={`block text-meta ${paid ? "text-white/85" : ""}`}>{s.sub}</span>}
            </span>
          </li>
        ))}
      </ol>
      {paid && (
        <Link href="/earnings" className={`${btn.secondary} w-full`}>
          <Wallet aria-hidden size={18} /> {t("outcome.toEarnings")}
        </Link>
      )}
    </section>
  );
}
