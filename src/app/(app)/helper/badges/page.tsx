import Link from "next/link";
import { FlowHeader, Note, btn } from "@/components/ui";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { myBadges, onTimeFor, onTimePct } from "@/lib/badges";
import { createAdminClient } from "@/lib/supabase/admin";
import { BadgeForm } from "./badge-form";
import { LanguagesForm } from "./languages-form";
import { unverifiedHelpersTestMode } from "@/lib/helper-test-mode";
import { notFound } from "next/navigation";
import { AlarmClock, Car, IdCard } from "lucide-react";
import { Ico } from "@/components/icon";
import { titled } from "@/lib/page-title";

export const generateMetadata = titled("badges.title");

/**
 * /helper/badges — what lets a helper take tasks with conditions (docs/decisions.md 2026-11-18): a
 * driver's licence / own car checked by Ops, the on-time record, and self-declared languages.
 */
export default async function BadgesPage() {
  if (unverifiedHelpersTestMode) notFound();
  const viewer = await getViewer();
  if (!viewer) return null;
  const t = await getT();
  if (!viewer.actor.helperApproved) {
    return (
      <>
        <FlowHeader href="/profile" label={t("common.back")} title={t("badges.title")} />
        <Note tone="info">{t("cert.needHelper")}</Note>
        <Link href="/helper/apply" className={`${btn.primary} w-full`}>
          {t("cert.becomeHelper")}
        </Link>
      </>
    );
  }
  const [mine, record, { data: me }] = await Promise.all([
    myBadges(viewer.profile.id),
    onTimeFor(viewer.profile.id),
    createAdminClient().from("profiles").select("languages").eq("id", viewer.profile.id).single<{ languages: string[] }>(),
  ]);
  const b = viewer.actor.badges;
  const pct = onTimePct(record);
  const open = (kind: "driver" | "car") => !mine.some((x) => x.kind === kind && (x.status === "pending" || x.status === "approved"));
  return (
    <>
      <FlowHeader href="/profile" label={t("common.back")} title={t("badges.title")} />
      <Note tone="info">{t("badges.intro")}</Note>

      <section className="flex flex-col gap-2 rounded-card bg-bg p-4 shadow-card">
        <p><Ico as={IdCard} /> {t("conditions.b.driver")}: <b>{b?.driver ? t("badges.yes") : t("badges.no")}</b></p>
        <p><Ico as={Car} /> {t("conditions.b.car")}: <b>{b?.car ? t("badges.yes") : t("badges.no")}</b></p>
        <p><Ico as={AlarmClock} /> {pct === null ? t("badges.onTimeNew") : t("badges.onTime", { pct, n: record.jobs })}</p>
      </section>

      {mine.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="font-bold">{t("badges.requests")}</h2>
          {mine.map((x) => (
            <p key={x.id} className="rounded-input bg-fill p-3 text-body">
              {x.kind === "driver" ? <Ico as={IdCard} /> : <Ico as={Car} />} {Object.values(x.info).join(" · ")} — <b>{t(`badges.status.${x.status}`)}</b>
              {x.reviewNote && <span className="block text-small text-ink-2">{x.reviewNote}</span>}
            </p>
          ))}
        </section>
      )}

      {open("driver") && <BadgeForm kind="driver" />}
      {open("car") && <BadgeForm kind="car" />}
      <LanguagesForm current={me?.languages ?? []} />
    </>
  );
}
