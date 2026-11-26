import { openSupportCount } from "@/lib/support";
import Link from "next/link";
import { reportedPhotoCount } from "@/lib/work-photos";
import { withdrawalQueue } from "@/lib/withdrawals";
import { openErrorCount } from "@/lib/error-log";
import { notFound } from "next/navigation";
import { PushToggle } from "@/components/push-toggle";
import { FlowHeader, Note } from "@/components/ui";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { openIncidentCounts } from "@/lib/incidents";
import { reviewQueue } from "@/lib/kyc";
import { fmtDuration } from "@/lib/format";
import { tickHealth } from "@/lib/health-rules";
import { certificateQueue, orgQueue } from "@/lib/orgs";
import { getControls } from "@/lib/safety";
import { tickHeartbeat } from "@/lib/scheduler";
import { AlarmClock, Building2, Siren, Car, CreditCard, FireExtinguisher, IdCard, Image, Landmark, MessageCircle, Pencil, ScrollText, ShieldCheck, Tag, Timer } from "lucide-react";
import { Ico } from "@/components/icon";
import type { LucideIcon } from "lucide-react";
import { titled } from "@/lib/page-title";

export const generateMetadata = titled("opsHome.title");

/** /ops — the operations hub (admins only; others get a 404). */
export default async function OpsHome() {
  const viewer = await getViewer();
  if (!viewer || viewer.profile.role !== "admin") notFound();
  const [t, queue, incidents, controls, hb, orgs, certs, reported, payouts, errorsOpen, supportOpen] = await Promise.all([
    getT(),
    reviewQueue(),
    openIncidentCounts(),
    getControls(),
    tickHeartbeat().catch(() => null),
    orgQueue(),
    certificateQueue(),
    reportedPhotoCount(),
    withdrawalQueue(),
    openErrorCount(),
    openSupportCount().catch(() => 0),
  ]);
  const orgsPending = orgs.filter((o) => o.status === "pending").length;
  const health = tickHealth(hb, Date.now());
  const ago =
    !("agoMs" in health) || !Number.isFinite(health.agoMs)
      ? "—"
      : health.agoMs < 60_000
        ? t("opsHome.secs", { s: Math.round(health.agoMs / 1000) })
        : fmtDuration(health.agoMs, t);
  const row = (href: string, icon: LucideIcon, label: string, badge: string | null, urgent = false) => (
    <Link href={href} className="press flex items-center justify-between gap-3 border-b border-line py-4">
      <span className="flex items-center gap-3 font-semibold">
        <Ico as={icon} size={20} className="text-ink-2" /> {label}
      </span>
      {badge && <span className={`rounded-full px-2.5 py-0.5 text-small font-bold ${urgent ? "bg-danger text-white" : "bg-fill text-ink"}`}>{badge}</span>}
    </Link>
  );
  return (
    <>
      <FlowHeader href="/profile" label={t("common.back")} title={t("opsHome.title")} />
      {(controls.postingPaused || controls.paymentsPaused) && (
        <Note tone="bad">
          {[controls.postingPaused && t("opsSafety.postingOn"), controls.paymentsPaused && t("opsSafety.paymentsOn")].filter(Boolean).join(" · ")}
        </Note>
      )}
      {/* background jobs: expiries, auto-release, SOS reminders all depend on it */}
      <Note tone={health.state === "ok" ? "held" : health.state === "failing" ? "warn" : "bad"}>
        <span className="font-semibold">{t("opsHome.system")}: </span>
        {health.state === "ok"
          ? t("opsHome.tickOk", { ago })
          : health.state === "never"
            ? t("opsHome.tickNever")
            : health.state === "stopped"
              ? t("opsHome.tickStopped", { ago })
              : t("opsHome.tickFailing", { ago, error: health.error.slice(0, 120) })}
      </Note>
      <nav className="flex flex-col">
        {row(
          "/ops/incidents",
          Siren,
          t("opsIncidents.title"),
          incidents.open ? (incidents.sos ? t("opsHome.sosCount", { n: incidents.sos, all: incidents.open }) : String(incidents.open)) : null,
          incidents.sos > 0,
        )}
        {row("/ops/helpers", IdCard, t("ops.title"), queue.length ? String(queue.length) : null)}
        {row("/ops/errors", FireExtinguisher, t("opsErrors.title"), errorsOpen ? String(errorsOpen) : null, errorsOpen > 0)}
        {row("/ops/marks", AlarmClock, t("opsMarks.title"), null)}
        {row("/ops/support", MessageCircle, t("opsSupport.title"), supportOpen ? String(supportOpen) : null, supportOpen > 0)}
        {row("/ops/safety", ShieldCheck, t("opsSafety.title"), null)}
        {row("/ops/pricing", Tag, t("opsPricing.title"), null)}
        {row("/ops/rules", Timer, t("opsRules.title"), null)}
        {row("/ops/payments", CreditCard, t("opsPay.title"), null)}
        {row("/ops/withdrawals", Landmark, t("opsWithdraw.title"), payouts.length ? String(payouts.length) : null, payouts.length > 0)}
        {row("/ops/badges", Car, t("opsBadges.title"), null)}
        {row("/ops/orgs", Building2, t("opsOrgs.title"), orgsPending ? String(orgsPending) : null)}
        {row("/ops/certificates", ScrollText, t("opsCerts.title"), certs.length ? String(certs.length) : null)}
        {row("/ops/content", Pencil, t("opsContent.title"), null)}
        {row("/ops/photos", Image, t("opsPhotos.title"), reported ? String(reported) : null, reported > 0)}
      </nav>
      {/* SOS alerts arrive as push: Ops must switch it on for the phone they carry */}
      <section className="flex flex-col gap-2">
        <p className="text-body text-ink-2">{t("opsHome.pushHelp")}</p>
        <PushToggle />
      </section>
    </>
  );
}
