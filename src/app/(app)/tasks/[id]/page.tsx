import { notFound } from "next/navigation";
import { getLocale, getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { getDealForViewer, myRating, publicProfiles, timeline } from "@/lib/deals/queries";
import { mockPaymentsEnabled } from "@/lib/payments/provider";
import { taskAction } from "./actions";
import { DealView } from "./deal-view";

export default async function TaskPage({ params, searchParams }: PageProps<"/tasks/[id]">) {
  const viewer = await getViewer();
  if (!viewer) return null;
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const deal = await getDealForViewer(id, viewer);
  if (!deal || deal.type !== "errand") notFound();

  const [events, rated, t, locale] = await Promise.all([timeline(deal.id), myRating(deal.id, viewer.profile.id), getT(), getLocale()]);
  const people = await publicProfiles([
    deal.customerId,
    deal.helperId,
    ...deal.offers.map((o) => o.helperId),
    ...events.map((e) => e.data.helperId as string | undefined),
  ]);

  return (
    <DealView
      deal={deal}
      events={events}
      people={people}
      viewerId={viewer.profile.id}
      serverNow={Date.now()}
      t={t}
      locale={locale}
      rated={rated}
      autoOpenPay={sp.pay === "1"}
      mockPay={mockPaymentsEnabled()}
      action={taskAction}
    />
  );
}
