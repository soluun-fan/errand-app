import { BadgeCheck, Ban, Landmark, MapPinOff, MessageCircle, Siren } from "lucide-react";
import type { Metadata } from "next";
import { FlowHeader } from "@/components/ui";
import { getT } from "@/i18n/server";

export const metadata: Metadata = { title: "Tuslamj — Аюулгүй байдал" };

/** /safety — what the app actually does today to protect people (no promises it doesn't keep). */
export default async function SafetyPage() {
  const t = await getT();
  const items = [
    { icon: Landmark, title: t("info.sMoneyT"), body: t("info.sMoneyB") },
    { icon: BadgeCheck, title: t("info.sPeopleT"), body: t("info.sPeopleB") },
    { icon: MapPinOff, title: t("info.sPlaceT"), body: t("info.sPlaceB") },
    { icon: MessageCircle, title: t("info.sTalkT"), body: t("info.sTalkB") },
    { icon: Siren, title: t("info.sHelpT"), body: t("info.sHelpB") },
    { icon: Ban, title: t("info.sPayT"), body: t("info.sPayB") },
  ];
  return (
    <>
      <FlowHeader href="/" label={t("common.back")} />
      <h1 className="text-[24px] font-bold tracking-tight">{t("info.safetyTitle")}</h1>
      <p className="text-[15px] text-ink-2">{t("info.safetyIntro")}</p>
      <ul className="flex flex-col gap-2.5">
        {items.map((x) => (
          <li key={x.title} className="flex gap-3 rounded-card bg-bg p-4 shadow-card">
            <span aria-hidden className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-brand-bg text-brand-ink">
              <x.icon size={20} />
            </span>
            <span className="flex flex-col gap-1">
              <b className="text-[16px]">{x.title}</b>
              <span className="text-[14px] leading-relaxed text-ink-2">{x.body}</span>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
