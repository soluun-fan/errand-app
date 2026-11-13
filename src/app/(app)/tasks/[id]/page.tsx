import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { getLocale, getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { getDealForViewer, myRating, publicProfiles, timeline } from "@/lib/deals/queries";
import { mockPaymentsEnabled } from "@/lib/payments/provider";
import { rankApplicants } from "@/lib/dispatch/rank";
import { createAdminClient } from "@/lib/supabase/admin";
import { pokeTask, taskAction } from "./actions";
import { DealView } from "./deal-view";

export default async function TaskPage({ params }: PageProps<"/tasks/[id]">) {
  const viewer = await getViewer();
  if (!viewer) return null;
  const { id } = await params;
  const deal = await getDealForViewer(id, viewer);
  if (!deal || deal.type !== "errand") notFound();

  const [events, rated, t, locale] = await Promise.all([timeline(deal.id), myRating(deal.id, viewer.profile.id), getT(), getLocale()]);
  const people = await publicProfiles([
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
  // The helper's live position (sent by their phone during the job; ignored if older than 10 min).
  let helperPos: { lat: number; lng: number } | null = null;
  if (isCustomer && deal.helperId && (deal.status === "matched" || deal.status === "in_progress")) {
    const { data: pos } = await createAdminClient()
      .from("helper_presence")
      .select("lat, lng, updated_at")
      .eq("user_id", deal.helperId)
      .maybeSingle<{ lat: number | null; lng: number | null; updated_at: string }>();
    if (pos?.lat != null && pos.lng != null && Date.now() - Date.parse(pos.updated_at) < 10 * 60_000) {
      helperPos = { lat: pos.lat, lng: pos.lng };
    }
  }
  const live = ["open", "awaiting_payment", "matched", "in_progress"].includes(deal.status);

  return (
    <>
    {live && <AutoRefresh seconds={deal.status === "open" ? 10 : 20} poke={isCustomer ? pokeTask.bind(null, deal.id) : undefined} />}
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
      helperPos={helperPos}
    />
    </>
  );
}
