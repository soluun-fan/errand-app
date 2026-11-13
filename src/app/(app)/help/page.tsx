import { Card, FlowHeader } from "@/components/ui";
import { getT } from "@/i18n/server";
import { DEFAULT_CONFIG } from "@/lib/engine";
import { fmtMoney } from "@/lib/format";

/** "How it works" — the plain-words explanation, with the formal terms at the end (UI-FLOWS §0.6). */
export default async function HelpPage() {
  const t = await getT();
  const cfg = DEFAULT_CONFIG;
  return (
    <>
      <FlowHeader href="/" label={t("common.back")} />
      <h1 className="text-[28px] font-bold">{t("help.title")}</h1>
      <ol className="flex flex-col gap-2">
        {(["s1", "s2", "s3"] as const).map((k, i) => (
          <li key={k} className="flex gap-3 rounded-card border border-line bg-bg p-4">
            <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-ink text-sm font-bold text-white">{i + 1}</span>
            <span className="text-[15px]">{t(`help.${k}`)}</span>
          </li>
        ))}
      </ol>
      <Card>
        <h2 className="font-bold">🔒 {t("help.protectTitle")}</h2>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[15px]">
          <li>{t("help.protect1")}</li>
          <li>{t("help.protect2")}</li>
          <li>{t("help.protect3")}</li>
        </ul>
      </Card>
      <Card>
        <h2 className="font-bold">{t("help.feesTitle")}</h2>
        <p className="text-[15px]">
          {t("help.fees", { service: fmtMoney(cfg.serviceFee), pct: cfg.commissionBps / 100, cancel: fmtMoney(cfg.cancelFee) })}
        </p>
      </Card>
      <Card>
        <h2 className="font-bold">{t("help.termsTitle")}</h2>
        <p className="text-sm text-ink-2">{t("help.terms")}</p>
      </Card>
    </>
  );
}
