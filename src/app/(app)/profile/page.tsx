import Link from "next/link";
import { signOut } from "@/app/login/actions";
import { Card, FlowHeader, btn } from "@/components/ui";
import { LOCALES } from "@/i18n";
import { getLocale, getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { getMode } from "@/lib/mode";
import { formatMnPhone } from "@/lib/phone";
import { setLocale, setMode } from "@/lib/prefs";

function Segmented({ name, value, options, action }: { name: string; value: string; options: [string, string][]; action: (f: FormData) => Promise<void> }) {
  return (
    <form action={action} className="grid grid-cols-2 gap-1 rounded-full bg-fill p-1">
      {options.map(([v, label]) => (
        <button
          key={v}
          name={name}
          value={v}
          aria-pressed={v === value}
          className={`min-h-11 rounded-full text-[15px] font-semibold ${v === value ? "bg-bg text-ink shadow-float" : "text-ink-2"}`}
        >
          {label}
        </button>
      ))}
    </form>
  );
}

export default async function ProfilePage() {
  const viewer = await getViewer();
  if (!viewer) return null;
  const [t, locale, mode] = await Promise.all([getT(), getLocale(), getMode()]);
  const { profile, actor } = viewer;
  const row = (label: string, value: string) => (
    <div className="flex justify-between gap-4 text-[15px]">
      <span className="text-ink-2">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );

  return (
    <>
      <FlowHeader href={mode === "helper" ? "/jobs" : "/"} label={t("common.back")} title={t("profile.title")} />
      <h2 className="text-[28px] font-bold">{profile.name || t("profile.title")}</h2>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-ink-2">{t("mode.label")}</h2>
        <Segmented
          name="mode"
          value={mode}
          action={setMode}
          options={[
            ["customer", t("mode.customer")],
            ["helper", t("mode.helper")],
          ]}
        />
      </section>

      <Card>
        {row(t("profile.phone"), profile.phone ? formatMnPhone(profile.phone) : "—")}
        {row(t("profile.level"), t("profile.levelValue", { n: profile.kyc_level }))}
        {row(t("profile.role"), t(`profile.roles.${profile.role}`))}
        {profile.role === "helper" &&
          row(t("profile.helperStatus"), actor.helperApproved ? t("profile.helperApproved") : t(`helper.${profile.helper_status === "pending" ? "inReview" : "needed"}`))}
      </Card>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-ink-2">{t("lang.label")}</h2>
        <Segmented name="locale" value={locale} action={setLocale} options={LOCALES.map((l) => [l, t(`lang.${l}`)])} />
      </section>

      <Link href="/help" className={`${btn.secondary} w-full`}>
        {t("profile.help")}
      </Link>
      <form action={signOut}>
        <button className={`${btn.textDanger} w-full`}>{t("profile.signOut")}</button>
      </form>
    </>
  );
}
