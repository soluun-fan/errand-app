import { AlarmClock, Briefcase, ChevronRight, CircleHelp, HandHelping, Heart, House, IdCard, Landmark, LifeBuoy, MapPin, ScrollText, ShieldCheck, UserRound } from "lucide-react";
import { TodoCard } from "@/components/todo-card";
import { helperTodos } from "@/lib/todo";
import Link from "next/link";
import { signOut } from "@/app/login/actions";
import { Avatar, Card, LinkRow, btn, field, fieldLabel, pageTitle } from "@/components/ui";
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
import { unverifiedHelpersTestMode } from "@/lib/helper-test-mode";
import { Ico } from "@/components/icon";
import { titled } from "@/lib/page-title";

export const generateMetadata = titled("profile.title");

const KIND_ICON = { home: <House aria-hidden size={22} />, work: <Briefcase aria-hidden size={22} />, other: <MapPin aria-hidden size={22} /> } as const;

function Segmented({ name, value, options, action }: { name: string; value: string; options: [string, string][]; action: (f: FormData) => Promise<void> }) {
  return (
    <form action={action} className="grid grid-cols-2 gap-1 rounded-full bg-fill p-1">
      {options.map(([v, label]) => (
        <button
          key={v}
          name={name}
          value={v}
          aria-pressed={v === value}
          className={`min-h-11 rounded-full text-body font-semibold ${v === value ? "bg-bg text-ink shadow-float" : "text-ink-2"}`}
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
    // label left, value right on the same line; a long label wraps instead of pushing the value down
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 text-body">
      <span className="text-ink-2">{label}</span>
      <span className="break-words text-right font-medium">{value}</span>
    </div>
  );

  return (
    <>
      <header className="flex items-center gap-3">
        <Avatar name={profile.name || "?"} size={56} />
        <h1 className={`${pageTitle} min-w-0 flex-1 break-words`}>{profile.name || t("profile.title")}</h1>
      </header>
      {/* PleaseHelp-style invitation: a customer who has never applied sees how to start helping */}
      {mode === "customer" && profile.role === "customer" && !profile.helper_status && (
        <Link href="/helper/apply" className="press flex items-center gap-3 rounded-card bg-brand-bg p-4">
          <span aria-hidden className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-brand text-white">
            <HandHelping size={22} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-lead font-bold text-brand-ink">{t("helper.becomeTitle")}</span>
            <span className="block text-small text-ink-2">{t("profile.becomeSub")}</span>
          </span>
          <ChevronRight aria-hidden size={20} className="flex-none text-brand-ink" />
        </Link>
      )}
      {(mode === "helper" || profile.role === "helper" || profile.helper_status) && (!unverifiedHelpersTestMode || actor.helperApproved) && <TodoCard items={await helperTodos(viewer)} t={t} />}
      {sp.org === "sent" && <p role="status" className="rounded-card bg-held-bg p-4 text-held">{t("org.sent")}</p>}
      {actor.helperApproved && (
        <section id="work-kinds" className="flex scroll-mt-20 flex-col gap-2">
          <h2 className="text-title font-bold">{t("workKinds.title")}</h2>
          <WorkKinds all={OPEN_CATEGORIES} mine={profile.categories} />
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-title font-bold">{t("mode.label")}</h2>
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
          row(t("profile.helperStatus"), actor.helperApproved ? profile.kyc_level < 3 ? t("kyc.badgeUnverified") : t("profile.helperApproved") : t(`helper.${profile.helper_status === "pending" ? "inReview" : "needed"}`))}
      </Card>

      {/* one menu of places to go: people, then (helpers) payout, papers and record */}
      {(mode === "customer" || actor.helperApproved || viewer.profile.helper_status === "approved") && (
        <nav className="flex flex-col rounded-card bg-bg shadow-card">
          {mode === "customer" && <LinkRow href="/helpers?saved=1" icon={Heart} label={t("helperProfile.savedTitle")} />}
          {mode === "customer" && <LinkRow href="/verify" icon={IdCard} label={profile.kyc_level >= 3 ? t("verify.badge") : t("verify.link")} />}
          {actor.helperApproved && <LinkRow href={`/helpers/${profile.id}`} icon={UserRound} label={t("helperProfile.title")} />}
          {actor.helperApproved && !(unverifiedHelpersTestMode && profile.test_helper) && <LinkRow href="/helper/bank" icon={Landmark} label={t("payout.title")} />}
          {(actor.helperApproved || viewer.profile.helper_status === "approved") && <LinkRow href="/helper/record" icon={AlarmClock} label={t("standards.recordTitle")} />}
          {actor.helperApproved && !unverifiedHelpersTestMode && <LinkRow href="/helper/certificates" icon={ScrollText} label={t("cert.title")} />}
          {actor.helperApproved && !unverifiedHelpersTestMode && <LinkRow href="/helper/badges" icon={IdCard} label={t("badges.title")} />}
        </nav>
      )}

      {mode === "customer" && (
        <section className="flex flex-col gap-2">
          <h2 className="text-title font-bold">{t("profile.addresses")}</h2>
          {addresses.length === 0 ? (
            <p className="text-body text-ink-2">{t("profile.addressesEmpty")}</p>
          ) : (
            <ul className="flex flex-col rounded-card bg-bg shadow-card">
              {addresses.map((a) => {
                const label = a.kind === "other" ? (a.label ?? a.address) : t(`task.saved.${a.kind}`);
                const bits = [
                  a.entrance && t("details.entrance", { v: a.entrance }),
                  a.floor !== null && t("details.floor", { v: a.floor }),
                  a.unit && t("details.unit", { v: a.unit }),
                ].filter((x): x is string => typeof x === "string" && x.length > 0);
                return (
                  <li key={a.id} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
                    <span aria-hidden className="text-title-lg">
                      {KIND_ICON[a.kind]}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{label}</span>
                      <span className="block truncate text-small text-ink-2">{[a.address, ...bits].join(" · ")}</span>
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
        <h2 className="text-title font-bold">{t("lang.label")}</h2>
        <Segmented name="locale" value={locale} action={setLocale} options={LOCALES.map((l) => [l, t(`lang.${l}`)])} />
      </section>

      {profile.role === "admin" && (
        <Link href="/ops" className={`${btn.secondary} w-full`}>
          <Ico as={ShieldCheck} /> {t("opsHome.title")}
        </Link>
      )}
      <nav className="flex flex-col rounded-card bg-bg shadow-card">
        <LinkRow href="/support" icon={LifeBuoy} label={t("support.title")} />
        <LinkRow href="/help" icon={CircleHelp} label={t("profile.help")} />
      </nav>
      <section className="flex flex-col gap-3">
        <h2 className="text-title font-bold">{t("org.my")}</h2>
        {invitations.map((m) => <Membership key={m.orgId} invitation={m} pending />)}
        {orgs.filter((o) => o.status === "pending" || o.status === "approved").map((o) => <Link key={o.id} href={`/orgs/${o.id}`} className="rounded-card bg-bg p-4 shadow-card">
          <span className="block font-semibold">{o.name}</span><span className="text-small text-ink-2">{t(`org.statusShort.${o.status}`)}</span>
        </Link>)}
        {/* closed or refused companies stay reachable, folded away */}
        {orgs.some((o) => o.status === "suspended" || o.status === "rejected") && (
          <details className="rounded-card bg-bg px-4 py-3 shadow-card">
            <summary className="cursor-pointer text-body font-semibold text-ink-2">
              {t("org.closedCount", { n: orgs.filter((o) => o.status === "suspended" || o.status === "rejected").length })}
            </summary>
            <div className="mt-2 flex flex-col">
              {orgs.filter((o) => o.status === "suspended" || o.status === "rejected").map((o) => (
                <Link key={o.id} href={`/orgs/${o.id}`} className="flex justify-between gap-3 border-t border-line py-2.5 text-body">
                  <span className="min-w-0 truncate">{o.name}</span>
                  <span className="flex-none text-small text-ink-2">{t(`org.statusShort.${o.status}`)}</span>
                </Link>
              ))}
            </div>
          </details>
        )}
        {memberships.filter((m) => !orgs.some((o) => o.id === m.orgId)).map((m) => <Membership key={m.orgId} invitation={m} pending={false} />)}
        <Link href="/orgs/new" className={btn.secondary}>{t("org.newTitle")}</Link>
      </section>
      {/* the documents they agreed to, always one tap away */}
      <nav aria-label={t("legal.docs")} className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-small">
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
        triggerClass={`${btn.text} w-full text-meta text-ink-3`}
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
