import "server-only";
import type { PublicProfile, TimelineItem } from "@/lib/deals/queries";
import { amountDue, apply, createErrand, type Actor, type Command, type ErrandDeal, type UserActor } from "@/lib/engine";

/**
 * Sample deals for the gallery, produced by running the real engine — so every state,
 * timeline and amount is exactly what production would show.
 */
export const FX = {
  customer: "00000000-0000-4000-8000-0000000000c1",
  helper: "00000000-0000-4000-8000-0000000000a1",
  helper2: "00000000-0000-4000-8000-0000000000a2",
};

export const FIXTURE_PEOPLE = new Map<string, PublicProfile>([
  [FX.customer, { id: FX.customer, name: "Solongo B.", rating: null, rating_count: 0, completed_count: 0, kyc_level: 1 }],
  [FX.helper, { id: FX.helper, name: "Bat-Erdene G.", rating: 4.9, rating_count: 128, completed_count: 128, kyc_level: 3 }],
  [FX.helper2, { id: FX.helper2, name: "Nomin A.", rating: 4.8, rating_count: 61, completed_count: 61, kyc_level: 3 }],
]);

const customer: UserActor = { kind: "user", id: FX.customer, role: "customer" };
const helper = (id: string): UserActor => ({
  kind: "user",
  id,
  role: "helper",
  helperApproved: true,
  categories: ["shop", "carry", "queue", "deliver", "repair", "other"],
});
const provider: Actor = { kind: "provider" };
const system: Actor = { kind: "system" };

export const FIXTURE_STATES = [
  "awaiting_payment",
  "open_now",
  "open_schedule",
  "matched",
  "in_progress",
  "topup_pending",
  "topup_paid",
  "check",
  "disputed",
  "released",
  "refunded",
  "cancelled_fee",
  "expired_unpaid",
  "expired_no_helper",
] as const;
export type FixtureState = (typeof FIXTURE_STATES)[number];

export function buildFixture(state: FixtureState, now: number): { deal: ErrandDeal; events: TimelineItem[] } {
  const MIN = 60_000;
  const schedule = state === "open_schedule";
  let at = now - (state === "expired_unpaid" ? 31 : state === "expired_no_helper" ? 45 : 70) * MIN;
  const events: TimelineItem[] = [];

  const created = createErrand(
    {
      id: `fixture-${state}`,
      title: "Groceries from Nomin",
      description: "2 L milk, bread, 10 eggs, apples (1 kg).\nBuilding 45, entrance 2, 4th floor.",
      category: "shop",
      mode: schedule ? "schedule" : "now",
      scheduledAt: schedule ? now + 26 * 60 * MIN : null,
      pickupAddress: "Nomin supermarket, Zaisan",
      address: "Khan-Uul, 11th khoroo, Bldg 45, apt 12",
      itemBudget: 5000,
      fee: 40000,
      customerId: FX.customer,
    },
    { now: at, actor: customer },
  );
  let deal = created.deal;
  events.push(...created.events);

  const run = (cmd: Command, actor: Actor, stepMin = 4) => {
    at += stepMin * MIN;
    const t = apply(deal, cmd, { now: Math.min(at, now), actor });
    deal = t.deal;
    events.push(...t.events);
  };
  const pay = () => run({ type: "confirm_payment", providerRef: `fx-${state}`, amount: amountDue(deal) }, provider, 1);
  const toCheck = () => {
    run({ type: "accept" }, helper(FX.helper));
    pay();
    run({ type: "start" }, helper(FX.helper));
    run({ type: "record_receipt", amount: 3250 }, helper(FX.helper), 15);
    run({ type: "record_handover" }, helper(FX.helper), 12);
    run({ type: "finish" }, helper(FX.helper), 1);
  };

  switch (state) {
    case "awaiting_payment":
      run({ type: "accept" }, helper(FX.helper));
      break;
    case "open_now":
      run({ type: "apply", note: "5 min away." }, helper(FX.helper));
      run({ type: "apply", note: "" }, helper(FX.helper2));
      break;
    case "open_schedule":
      run({ type: "apply", note: "I can come at the posted time." }, helper(FX.helper));
      run({ type: "apply", note: "I live 5 min away." }, helper(FX.helper2));
      break;
    case "matched":
      run({ type: "accept" }, helper(FX.helper));
      pay();
      break;
    case "in_progress":
      run({ type: "accept" }, helper(FX.helper));
      pay();
      run({ type: "start" }, helper(FX.helper));
      run({ type: "record_receipt", amount: 3250 }, helper(FX.helper), 15);
      break;
    case "topup_pending":
    case "topup_paid":
      run({ type: "accept" }, helper(FX.helper));
      pay();
      run({ type: "start" }, helper(FX.helper));
      run({ type: "record_receipt", amount: 6800 }, helper(FX.helper), 15); // budget 5,000 → 1,800 over
      if (state === "topup_paid") run({ type: "confirm_topup", providerRef: "fx-topup", amount: 1800 }, provider, 2);
      break;
    case "check":
      toCheck();
      break;
    case "disputed":
      toCheck();
      run({ type: "dispute", reason: "wrongItem", note: "Got skim milk instead of whole milk, and only 6 eggs." }, customer);
      break;
    case "released":
      toCheck();
      run({ type: "confirm" }, customer);
      break;
    case "refunded":
      toCheck();
      run({ type: "dispute", reason: "notDone", note: "Nobody came, but the task was marked done." }, customer);
      run({ type: "resolve", outcome: "refund" }, { kind: "user", id: "ops", role: "admin" });
      break;
    case "cancelled_fee":
      run({ type: "accept" }, helper(FX.helper));
      pay();
      run({ type: "cancel" }, customer);
      break;
    case "expired_unpaid":
      run({ type: "accept" }, helper(FX.helper));
      at = now;
      run({ type: "expire" }, system, 0); // match deadline passed while waiting for payment
      break;
    case "expired_no_helper":
      at = now;
      run({ type: "expire" }, system, 0);
      break;
  }
  return {
    deal: deal as ErrandDeal,
    events: events.map((e) => ({ code: e.code, data: e.data, at: e.at })),
  };
}
