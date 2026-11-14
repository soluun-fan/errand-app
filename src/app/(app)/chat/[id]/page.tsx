import { notFound } from "next/navigation";
import { Avatar, FlowHeader } from "@/components/ui";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { callParty } from "@/lib/calls";
import { accessFor, loadThread, markSeen } from "@/lib/chat";
import { loadDeal } from "@/lib/db/deals";
import { publicProfiles } from "@/lib/deals/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { ChatRoom } from "./chat-room";

/**
 * /chat/[taskId] — the viewer's conversation for this task (customer ⇄ chosen helper).
 * Access is decided by `accessFor` (same rule as the database's RLS); strangers get a 404.
 */
export default async function ChatPage({ params, searchParams }: PageProps<"/chat/[id]">) {
  const viewer = await getViewer();
  if (!viewer) return null;
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const initialCallId = typeof sp.call === "string" && /^[0-9a-f-]{36}$/i.test(sp.call) ? sp.call : null;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const deal = await loadDeal(createAdminClient(), id);
  if (!deal || deal.type !== "errand") notFound();
  const me = viewer.profile.id;
  const access = await accessFor(deal, me);
  if (!access.canRead || !access.threadHelperId || !access.counterpartId) notFound();

  const [t, people, messages] = await Promise.all([
    getT(),
    publicProfiles([access.counterpartId]),
    loadThread(deal.id, access.threadHelperId, me),
  ]);
  await markSeen(deal.id, access.threadHelperId, me);
  const other = people.get(access.counterpartId);
  const back = me === deal.customerId ? `/tasks/${deal.id}` : `/jobs/${deal.id}`;

  return (
    <>
      <FlowHeader href={back} label={t("common.back")} title={deal.title} />
      <div className="flex items-center gap-3">
        <Avatar name={other?.name ?? "?"} size={40} />
        <div className="min-w-0">
          <p className="truncate font-semibold">{other?.name ?? t("deal.newHelper")}</p>
          <p className="text-sm text-ink-2">{me === deal.customerId ? t("chat.withHelper") : t("chat.withCustomer")}</p>
        </div>
      </div>
      <ChatRoom
        dealId={deal.id}
        messages={messages}
        canSend={access.canSend}
        me={me}
        name={other?.name ?? t("deal.newHelper")}
        canCall={callParty(deal, me) !== null}
        initialCallId={initialCallId}
      />
    </>
  );
}
