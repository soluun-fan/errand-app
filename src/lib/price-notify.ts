import "server-only";
import type { Command, ErrandDeal } from "@/lib/engine";
import { fmtMoney } from "@/lib/format";
import { notify } from "@/lib/push";

/*
 * Kept out of the "use server" action files on purpose: anything exported there becomes a public
 * endpoint, and this sends notifications to arbitrary users.
 */

/** Tells the other side about a post-match price proposal or answer (shared with the helper's actions). */
export async function notifyPriceChange(deal: ErrandDeal, cmd: Command, fromName: string, to: string, url: string): Promise<void> {
  if (cmd.type === "propose_price") {
    await notify([to], { title: "push.priceProposedTitle", body: "push.priceProposedBody", params: { name: fromName, fee: fmtMoney(cmd.price), title: deal.title }, url, tag: `price-${deal.id}` });
  } else if (cmd.type === "answer_price") {
    const agreed = cmd.accept;
    await notify([to], {
      title: agreed ? "push.priceAgreedTitle" : "push.priceDeclinedTitle",
      body: agreed && deal.priceChange?.status === "awaiting_payment" ? "push.priceAgreedPayBody" : "push.priceAnsweredBody",
      params: { name: fromName, fee: fmtMoney(deal.priceChange?.fee ?? deal.fee), title: deal.title },
      url,
      tag: `price-${deal.id}`,
    });
  }
}

