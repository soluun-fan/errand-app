import { ChevronRight, Heart, UserRound } from "lucide-react";
import { TodoCard } from "@/components/todo-card";
import { helperTodos } from "@/lib/todo";
import Link from "next/link";
import { signOut } from "@/app/login/actions";
import { Card, FlowHeader, btn, field, fieldLabel } from "@/components/ui";
import { LOCALES } from "@/i18n";
import { getLocale, getT } from "@/i18n/server";
import { listSavedAddresses } from "@/lib/addresses";
import { getViewer } from "@/lib/auth";
import { getMode } from "@/lib/mode";
import { formatMnPhone } from "@/lib/phone";
import { setLocale, setMode } from "@/lib/prefs";
import { myOrganizations, myInvitations, myMemberships } from "@/lib/orgs";
import { Membership } from "./org-memberships";
import { WorkKinds } from "./work-kinds";
import { OPEN_CATEGORIES } from "@/lib/engine";
import { closeMyAccount, removeAddress } from "./actions";
import { ConfirmSheet } from "@/components/sheet";

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

export default async function ProfilePage({ searchParams }: PageProps<"/profile">) {
  const viewer = await getViewer();
  if (!viewer) return null;
  const [t, locale, mode, addresses] = await Promise.all([getT(), getLocale(), getMode(), listSavedAddresses()]);
  const { profile, actor } = viewer;
  const [orgs, invitations, memberships, sp] = await Promise.all([myOrganizations(profile.id), myInvitations(profile.id), myMemberships(profile.id), searchParams]);
  const row = (label: string, value: string) => (
    <div className="flex justify-between gap-4 text-[15px]">
      <span className="text-ink-2">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );

  return (
    <>
      <FlowHeader href={mode === "helper" ? "/jobs" : "/"} label={t("common.back")} title={t("profile.title")} />
      <h2 className="text-[24px] font-bold tracking-tight">{profile.name || t("profile.title")}</h2>
      {(mode === "helper" || profile.role === "helper" || profile.helper_status) && <TodoCard items={await helperTodos(viewer)} t={t} />}
      {sp.org === "sent" && <p role="status" className="rounded-card bg-held-bg p-4 text-held">{t("org.sent")}</p>}
      {actor.helperApproved && (
        <section id="work-kinds" className="flex scroll-mt-20 flex-col gap-2">
          <h2 className="text-[17px] font-bold">{t("workKinds.title")}</h2>
          <WorkKinds all={OPEN_CATEGORIES} mine={profile.categories} />
        </section>
      )}
      <section className="flex flex-col gap-3">
        <h2 className="text-[17px] font-bold">{t("org.my")}</h2>
        {invitations.map((m) => <Membership key={m.orgId} invitation={m} pending />)}
        {orgs.filter((o) => o.status === "pending" || o.status === "approved").map((o) => <Link key={o.id} href={`/orgs/${o.id}`} className="rounded-card bg-bg p-4 shadow-card">
          <span className="block font-semibold">{o.name}</span><span className="text-sm text-ink-2">{t(`org.statusShort.${o.status}`)}</span>
        </Link>)}
        {/* closed or refused companies stay reachable, folded away */}
        {orgs.some((o) => o.status === "suspended" || o.status === "rejected") && (
          <details className="rounded-card bg-bg px-4 py-3 shadow-card">
            <summary className="cursor-pointer text-[15px] font-semibold text-ink-2">
              {t("org.closedCount", { n: orgs.filter((o) => o.status === "suspended" || o.status === "rejected").length })}
            </summary>
            <div className="mt-2 flex flex-col">
              {orgs.filter((o) => o.status === "suspended" || o.status === "rejected").map((o) => (
                <Link key={o.id} href={`/orgs/${o.id}`} className="flex justify-between gap-3 border-t border-line py-2.5 text-[15px]">
                  <span className="min-w-0 truncate">{o.name}</span>
                  <span className="flex-none text-sm text-ink-2">{t(`org.statusShort.${o.status}`)}</span>
                </Link>
              ))}
            </div>
          </details>
        )}
        {memberships.filter((m) => !orgs.some((o) => o.id === m.orgId)).map((m) => <Membership key={m.orgId} invitation={m} pending={false} />)}
        <Link href="/orgs/new" className={btn.secondary}>{t("org.newTitle")}</Link>
        {actor.helperApproved && <Link href="/helper/bank" className={btn.secondary}>{t("payout.title")}</Link>}
        {actor.helperApproved && <Link href="/helper/certificates" className={btn.secondary}>{t("cert.title")}</Link>}
        {actor.helperApproved && <Link href="/helper/badges" className={btn.secondary}>{t("badges.title")}</Link>}
      </section>

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

      {/* people: my saved helpers (customer) · my public profile (approved helper) */}
      {(mode === "customer" || actor.helperApproved) && (
      <nav className="flex flex-col rounded-card bg-bg shadow-card">
        {mode === "customer" && (
          <Link href="/helpers?saved=1" className="press flex min-h-14 items-center gap-3 border-b border-line px-4 last:border-b-0">
            <Heart aria-hidden size={18} className="text-brand-ink" />
            <span className="flex-1 font-semibold">{t("helperProfile.savedTitle")}</span>
            <ChevronRight aria-hidden size={18} className="text-ink-2" />
          </Link>
        )}
        {actor.helperApproved && (
          <Link href={`/helpers/${profile.id}`} className="press flex min-h-14 items-center gap-3 px-4">
            <UserRound aria-hidden size={18} className="text-brand-ink" />
            <span className="flex-1 font-semibold">{t("helperProfile.title")}</span>
            <ChevronRight aria-hidden size={18} className="text-ink-2" />
          </Link>
        )}
      </nav>
      )}

      {mode === "customer" && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-ink-2">{t("profile.addresses")}</h2>
          {addresses.length === 0 ? (
            <p className="text-[15px] text-ink-2">{t("profile.addressesEmpty")}</p>
          ) : (
            <ul className="flex flex-col rounded-card border border-line bg-bg">
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

      {profile.role === "admin" && (
        <Link href="/ops" className={`${btn.secondary} w-full`}>
          🛡️ {t("opsHome.title")}
        </Link>
      )}
      <Link href="/help" className={`${btn.secondary} w-full`}>
        {t("profile.help")}
      </Link>
      {/* the documents they agreed to, always one tap away */}
      <nav aria-label={t("legal.docs")} className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-[14px]">
        <Link href="/terms" className="font-medium text-ink-2 underline underline-offset-2">{t("legal.termsTitle")}</Link>
        <Link href="/privacy" className="font-medium text-ink-2 underline underline-offset-2">{t("info.privacyTitle")}</Link>
        {(profile.role === "helper" || profile.helper_status) && <Link href="/helper-terms" className="font-medium text-ink-2 underline underline-offset-2">{t("legal.helperTitle")}</Link>}
      </nav>
      <form action={signOut}>
        <button className={`${btn.textDanger} w-full`}>{t("profile.signOut")}</button>
      </form>
      <ConfirmSheet
        action={closeMyAccount}
        fields={{}}
        trigger={t("closeAccount.button")}
        triggerClass={`${btn.text} w-full text-[13px] text-ink-3`}
        title={t("closeAccount.title")}
        body={t("closeAccount.body")}
        confirmLabel={t("closeAccount.confirm")}
        confirmClass={btn.danger}
      >
        <label className={fieldLabel}>
          {t("closeAccount.typeWord", { word: t("closeAccount.word") })}
          <input name="confirm" autoComplete="off" className={field} />
        </label>
      </ConfirmSheet>
    </>
  );
}
