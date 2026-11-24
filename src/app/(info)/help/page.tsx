import { feeDescription } from "@/lib/fee-text";
import { Card, FlowHeader } from "@/components/ui";
import { CATEGORIES, lowestMinFee } from "@/lib/engine";
import { getT } from "@/i18n/server";
import { fmtMoney } from "@/lib/format";
import { pricingConfig } from "@/lib/pricing";
import { Lock } from "lucide-react";
import { Ico } from "@/components/icon";

/** "How it works" — the plain-words explanation, with the formal terms at the end (UI-FLOWS §0.6). */
export default async function HelpPage() {
  const [t, cfg] = await Promise.all([getT(), pricingConfig()]);
  // the service fee in words, from the live settings
  const tiers = feeDescription(cfg, t);
  return (
    <>
      <FlowHeader href="/" label={t("common.back")} />
      <h1 className="text-[24px] font-bold tracking-tight">{t("help.title")}</h1>
      <ol className="flex flex-col gap-2">
        {(["s1", "s2", "s3"] as const).map((k, i) => (
          <li key={k} className="flex gap-3 rounded-card bg-bg shadow-card p-4">
            <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-brand-bg text-sm font-bold text-brand-ink">{i + 1}</span>
            <span className="text-[15px]">{t(`help.${k}`, { amount: fmtMoney(lowestMinFee(CATEGORIES.map((c) => c.id), cfg)), hours: cfg.errandCheckHours })}</span>
          </li>
        ))}
      </ol>
      <Card>
        <h2 className="font-bold"><Ico as={Lock} /> {t("help.protectTitle")}</h2>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[15px]">
          <li>{t("help.protect1")}</li>
          <li>{t("help.protect2")}</li>
          <li>{t("help.protect3")}</li>
        </ul>
      </Card>
      <Card>
        <h2 className="font-bold">{t("help.feesTitle")}</h2>
        <p className="text-[15px]">
          {t("help.fees", { tiers, cancel: fmtMoney(cfg.cancelFee) })}
        </p>
      </Card>
      <Card>
        <h2 className="font-bold">{t("help.termsTitle")}</h2>
        <p className="text-sm text-ink-2">{t("help.terms")}</p>
      </Card>
    </>
  );
}
