import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { getLocale, getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { getDealForViewer, myRating, publicProfiles, timeline } from "@/lib/deals/queries";
import { mockPaymentsEnabled } from "@/lib/payments/provider";
import { organizationNames } from "@/lib/orgs";
import { rankApplicants } from "@/lib/dispatch/rank";
import { accessFor, hadCareCall, questionThreads, unreadCount } from "@/lib/chat";
import { categoryTrust, liveOffers } from "@/lib/engine";
import { proofsFor } from "@/lib/proofs";
import { firstAidHelpers, workedTogether } from "@/lib/care";
import { getRules } from "@/lib/rules";
import { badgesForMany, kycLevels } from "@/lib/badges";
import { handoverCodeFor } from "@/lib/handover-code";
import { taskPhotosFor } from "@/lib/task-photos";
import { createAdminClient } from "@/lib/supabase/admin";
import { SafetyBar } from "@/components/safety-bar";
import { SOS_STATUSES } from "@/lib/incident-rules";
import { isParty, liveSos } from "@/lib/incidents";
import { pokeTask, taskAction } from "./actions";
import { DealView } from "./deal-view";
import { PortfolioConsentCard } from "@/components/portfolio-cards";
import { taskWorkPhotos } from "@/lib/work-photos";
import { activeProvider, checkWirePayments } from "@/lib/payments/service";
import { directPayOpen, directPayState, payeeAccount } from "@/lib/direct-pay";
import { recipientVerificationForOwner } from "@/lib/verify-mn";
import { RecipientVerificationCard } from "./recipient-verification-card";

export default async function TaskPage({ params }: PageProps<"/tasks/[id]">) {
  const viewer = await getViewer();
  if (!viewer) return null;
  const { id } = await params;
  let deal = await getDealForViewer(id, viewer);
  if (!deal || deal.type !== "errand") notFound();
  if (deal.customerId !== viewer.profile.id && viewer.profile.role !== "admin") redirect(`/jobs/${id}`);
  // back from wire's payment page (or still waiting): ask wire directly, in case its webhook is slow
  const owes = deal.status === "awaiting_payment" || deal.topUp?.status === "pending" || deal.priceChange?.status === "awaiting_payment";
  if (owes && deal.customerId === viewer.profile.id && activeProvider() === "wire") {
    await checkWirePayments(deal.id).catch((e) => console.error("wire check failed", e));
    deal = (await getDealForViewer(id, viewer)) ?? deal;
    if (deal.type !== "errand") notFound();
  }

  const [events, rated, t, locale] = await Promise.all([timeline(deal.id), myRating(deal.id, viewer.profile.id), getT(), getLocale()]);
  const questions = await questionThreads(deal, viewer.profile.id);
  const people = await publicProfiles([
    ...questions.keys(),
    deal.customerId,
    deal.helperId,
    ...deal.offers.map((o) => o.helperId),
    ...events.map((e) => e.data.helperId as string | undefined),
  ]);

  const { data: dispatch } = await createAdminClient()
    .from("dispatch_state")
    .select("notified")
    .eq("deal_id", deal.id)
    .maybeSingle<{ notified: number }>();
  const isCustomer = deal.customerId === viewer.profile.id;
  const ranked = isCustomer && deal.status === "open" ? await rankApplicants(deal) : [];
  const chatAccess = await accessFor(deal, viewer);
  const chat = chatAccess.canRead && chatAccess.threadHelperId
    ? { unread: await unreadCount(deal.id, chatAccess.threadHelperId, viewer.profile.id) }
    : null;
  // while choosing: unread messages per applicant, and (care work) who the customer has really talked to
  const applicantIds = isCustomer && deal.status === "open" ? liveOffers(deal, Date.now()).map((o) => o.helperId) : [];
  const isCare = categoryTrust(deal.category) === "care";
  /** a call before choosing: always for care, or when the customer asked for it */
  const needsCall = isCare || Boolean(deal.details.require?.call);
  const [applicantUnread, careCalls, careKnown, firstAid] = await Promise.all([
    Promise.all(applicantIds.map(async (h) => [h, await unreadCount(deal.id, h, viewer.profile.id)] as const)).then((e) => new Map(e)),
    needsCall
      ? Promise.all(applicantIds.map(async (h) => ((await hadCareCall(deal.id, h)) ? h : null))).then((h) => new Set(h.filter((x): x is string => x !== null)))
      : Promise.resolve(new Set<string>()),
    isCare ? workedTogether(deal.customerId, applicantIds) : Promise.resolve(new Set<string>()),
    isCare ? firstAidHelpers(applicantIds) : Promise.resolve(new Set<string>()),
  ]);
  // The helper's live position (sent by their phone during the job; ignored if older than 90 seconds).
  let helperPos: { lat: number; lng: number } | null = null;
  if (isCustomer && deal.helperId && deal.status === "in_progress") {
    const { data: pos } = await createAdminClient()
      .from("job_locations")
      .select("lat, lng, updated_at")
      .eq("deal_id", deal.id)
      .eq("helper_id", deal.helperId)
      .maybeSingle<{ lat: number | null; lng: number | null; updated_at: string }>();
    if (pos?.lat != null && pos.lng != null && Date.now() - Date.parse(pos.updated_at) < 90_000) {
      helperPos = { lat: pos.lat, lng: pos.lng };
    }
  }
  // SOS + report a problem: for the two people on the task once a helper is chosen
  const safety =
    deal.helperId && isParty(deal, viewer.profile.id) ? (
      <SafetyBar
        dealId={deal.id}
        showSos={(SOS_STATUSES as readonly string[]).includes(deal.status)}
        live={await liveSos(deal.id, viewer.profile.id)}
      />
    ) : null;
  const live = ["open", "awaiting_payment", "matched", "in_progress"].includes(deal.status);
  const canVerifyRecipient = isCustomer && deal.category === "deliver" && live;
  const recipientVerification = canVerifyRecipient
    ? await recipientVerificationForOwner(deal.id, viewer.profile.id)
    : null;

  return (
    <>
    {live && <AutoRefresh seconds={deal.status === "open" ? 10 : 20} poke={isCustomer ? pokeTask.bind(null, deal.id) : undefined} />}
    {canVerifyRecipient && <RecipientVerificationCard dealId={deal.id} verification={recipientVerification} />}
    {questions.size > 0 && <section className="rounded-card bg-bg p-4 shadow-card">
      <h2 className="font-semibold">{t("chat.jobQuestions")}</h2>
      {[...questions].map(([helper, unread]) => (
        <Link key={helper} href={`/chat/${deal.id}?with=${helper}`} className="flex min-h-12 items-center justify-between gap-3 border-b border-line text-sm last:border-0">
          <span>{people.get(helper)?.name || t("deal.newHelper")}</span>
          <span className="font-semibold text-brand-ink">{unread ? t("chat.unread", { n: unread }) : t("chat.open")}</span>
        </Link>
      ))}
    </section>}
    <DealView
      deal={deal}
      events={events}
      people={people}
      viewerId={viewer.profile.id}
      serverNow={Date.now()}
      t={t}
      locale={locale}
      rated={rated}
      // a helper just accepted: open the pay sheet straight away
      autoOpenPay={isCustomer && deal.status === "awaiting_payment"}
      mockPay={mockPaymentsEnabled()}
      action={taskAction}
      dispatch={dispatch}
      ranked={ranked}
      organizations={await organizationNames([deal.payeeOrgId, ...deal.offers.map((o) => o.orgId)])}
      helperPos={helperPos}
      chat={chat}
      applicantUnread={applicantUnread}
      careCalls={careCalls}
      careKnown={careKnown}
      careCallSeconds={needsCall ? (await getRules()).careCallMinSeconds : undefined}
      needsCall={needsCall}
      applicantBadges={isCustomer && deal.status === "open" ? await badgesForMany(await kycLevels(applicantIds)) : undefined}
      handoverCode={isCustomer && deal.details.require?.handoverCode && (deal.status === "matched" || deal.status === "in_progress") ? await handoverCodeFor(deal.id) : null}
      firstAid={firstAid}
      safety={safety}
      wirePay={activeProvider() === "wire"}
      directPay={isCustomer && directPayOpen(deal) ? { state: await directPayState(deal), account: await payeeAccount(deal) } : null}
      photos={await taskPhotosFor(deal.id)}
      photosEditable={isCustomer && deal.status === "open" && categoryTrust(deal.category) !== "care"}
      workPhotos={
        isCustomer && deal.status === "released" && !isCare ? (
          <PortfolioConsentCard dealId={deal.id} photos={await taskWorkPhotos(deal.id)} helperName={(deal.helperId && people.get(deal.helperId)?.name) || t("deal.helperIs")} t={t} />
        ) : null
      }
      proofs={["in_progress", "check", "disputed", "released", "refunded"].includes(deal.status) ? await proofsFor(deal.id, { includeRemoved: viewer.profile.role === "admin" }) : []}
    />
    </>
  );
}
