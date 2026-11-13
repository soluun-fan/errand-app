import Link from "next/link";
import { signOut } from "@/app/login/actions";
import { Card, FlowHeader, btn } from "@/components/ui";
import { LOCALES } from "@/i18n";
import { getLocale, getT } from "@/i18n/server";
import { listSavedAddresses } from "@/lib/addresses";
import { getViewer } from "@/lib/auth";
import { getMode } from "@/lib/mode";
import { formatMnPhone } from "@/lib/phone";
import { setLocale, setMode } from "@/lib/prefs";
import { removeAddress } from "./actions";

const KIND_ICON = { home: "🏠", work: "💼", other: "📍" } as const;

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
  const [t, locale, mode, addresses] = await Promise.all([getT(), getLocale(), getMode(), listSavedAddresses()]);
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

      {mode === "customer" && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-ink-2">{t("profile.addresses")}</h2>
          {addresses.length === 0 ? (
            <p className="text-[15px] text-ink-2">{t("profile.addressesEmpty")}</p>
          ) : (
            <ul className="flex flex-col rounded-card border border-line">
              {addresses.map((a) => {
                const label = a.kind === "other" ? (a.label ?? a.address) : t(`task.saved.${a.kind}`);
                const bits = [
                  a.entrance && t("details.entrance", { v: a.entrance }),
                  a.floor !== null && t("details.floor", { v: a.floor }),
                  a.unit && t("details.unit", { v: a.unit }),
                ].filter((x): x is string => typeof x === "string" && x.length > 0);
                return (
                  <li key={a.id} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
                    <span aria-hidden className="text-xl">
                      {KIND_ICON[a.kind]}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{label}</span>
                      <span className="block truncate text-sm text-ink-2">{[a.address, ...bits].join(" · ")}</span>
                    </span>
                    <form action={removeAddress}>
                      <input type="hidden" name="id" value={a.id} />
                      <button aria-label={t("profile.removeAddress", { name: label })} className="flex h-11 w-11 items-center justify-center rounded-full text-ink-2 hover:bg-fill">
                        ✕
                      </button>
                    </form>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

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
