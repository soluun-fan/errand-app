import { notFound } from "next/navigation";
import { Avatar, FlowHeader, Note } from "@/components/ui";
import { categoryConfig } from "@/lib/engine";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { callParty, callsEnabled } from "@/lib/calls";
import { accessFor, loadThread, markSeen } from "@/lib/chat";
import { loadDeal } from "@/lib/db/deals";
import { publicProfiles } from "@/lib/deals/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { SafetyBar } from "@/components/safety-bar";
import { SOS_STATUSES } from "@/lib/incident-rules";
import { isParty, liveSos } from "@/lib/incidents";
import { ChatRoom } from "./chat-room";
import { titled } from "@/lib/page-title";

export const generateMetadata = titled("meta.chat");

/**
 * /chat/[taskId] — the viewer's conversation for this task (customer ⇄ chosen helper).
 * Access is decided by `accessFor` (same rule as the database's RLS); strangers get a 404.
 */
export default async function ChatPage({ params, searchParams }: PageProps<"/chat/[id]">) {
  const viewer = await getViewer();
  if (!viewer) return null;
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const initialCallId = typeof sp.call === "string" && /^[0-9a-f-]{36}$/i.test(sp.call) ? sp.call : null;
  // ?with=<helper>: which applicant's conversation (customer side, while choosing)
  const withHelper = typeof sp.with === "string" && /^[0-9a-f-]{36}$/i.test(sp.with) ? sp.with : null;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const deal = await loadDeal(createAdminClient(), id);
  if (!deal || deal.type !== "errand") notFound();
  const me = viewer.profile.id;
  const access = await accessFor(deal, viewer, Date.now(), withHelper);
  if (!access.canRead || !access.threadHelperId || !access.counterpartId) notFound();

  const [t, people, messages] = await Promise.all([
    getT(),
    publicProfiles([access.counterpartId]),
    loadThread(deal.id, access.threadHelperId, me),
  ]);
  await markSeen(deal.id, access.threadHelperId, me);
  const other = people.get(access.counterpartId);
  const back = me === deal.customerId ? `/tasks/${deal.id}` : `/jobs/${deal.id}`;
  // "Report a problem" (and SOS while they may meet) right here, for the two people on the task
  const canReport = Boolean(deal.helperId) && isParty(deal, me) && access.threadHelperId === deal.helperId;
  const sos = canReport ? await liveSos(deal.id, me) : null;

  return (
    <>
      <FlowHeader href={back} label={t("common.back")} title={deal.title} />
      <div className="flex items-center gap-3">
        <Avatar name={other?.name ?? "?"} size={40} />
        <div className="min-w-0">
          <p className="truncate font-semibold">{other?.name ?? t("deal.newHelper")}</p>
          <p className="text-small text-ink-2">{access.inquiry ? t("chat.beforeApplying") : deal.status === "open" ? (me === deal.customerId ? t("chat.withApplicant") : t("chat.withCustomerBefore")) : me === deal.customerId ? t("chat.withHelper") : t("chat.withCustomer")}</p>
        </div>
      </div>
      {canReport && <SafetyBar dealId={deal.id} showSos={(SOS_STATUSES as readonly string[]).includes(deal.status)} live={sos} />}
      {/* paying a shop by the QR the helper sends: check it is the shop, not a person (2026-11-27) */}
      {me === deal.customerId &&
        deal.status === "in_progress" &&
        categoryConfig(deal.category).items &&
        deal.category !== "deliver" &&
        (deal.itemBudget === 0 || deal.receiptAmount === 0) && <Note tone="warn">{t("shopPay.customerNote")}</Note>}
      <ChatRoom
        dealId={deal.id}
        messages={messages}
        canSend={access.canSend}
        textOnly={!!access.inquiry}
        me={me}
        name={other?.name ?? t("deal.newHelper")}
        callsAvailable={callsEnabled()}
        canCall={callsEnabled() && access.canSend && callParty(deal, me, withHelper)?.helperId === access.threadHelperId}
        initialCallId={initialCallId}
        withHelper={me === deal.customerId ? access.threadHelperId : null}
        canReport={canReport}
      />
    </>
  );
}
