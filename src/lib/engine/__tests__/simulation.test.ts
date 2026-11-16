/**
 * Random walk over many deals: fire random commands from random actors at random times.
 * Whatever happens, money must balance after every step, nothing is released twice,
 * and refund paths give the payer back everything.
 */
import { describe, expect, it } from "vitest";
import {
  EngineError,
  MINUTE_MS,
  TERMINAL_STATUSES,
  DEFAULT_DETAILS,
  amountDue,
  quoteFee,
  priceRange,
  apply,
  balanceOf,
  checkInvariants,
  createErrand,
  createGoods,
  ext,
  generateDealCode,
  invitedOnly,
  runDue,
  type Actor,
  type CategoryId,
  type Command,
  type Deal,
  type LedgerEntry,
  type Transition,
} from "../index";
import { T0, admin, customer, helper, provider } from "./helpers";

const seenEvents = new Set<string>();

/** Small deterministic PRNG (mulberry32) so failures are reproducible. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CATS: CategoryId[] = ["shop", "carry", "queue", "deliver", "repair", "other"];

function simulate(seed: number, steps: number) {
  const r = rng(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

  const users: Actor[] = [
    customer("c1"),
    customer("c2"),
    customer("c3"),
    helper("h1"),
    helper("h2", { categories: ["shop", "deliver", "queue"] }),
    helper("h3", { helperApproved: false }),
    admin(),
    provider,
    { kind: "system" },
  ];

  let now = T0;
  const deals = new Map<string, Deal>();
  const ledger: LedgerEntry[] = [];
  let n = 0;
  let applied = 0;
  let invitesChecked = 0;

  const record = (t: Transition) => {
    deals.set(t.deal.id, t.deal);
    ledger.push(...t.ledger);
    for (const e of t.events) seenEvents.add(e.code);
    applied++;
  };

  for (let i = 0; i < steps; i++) {
    now += int(0, 90) * MINUTE_MS;
    const roll = r();

    if (roll < 0.03 || deals.size === 0) {
      const c = pick(users.slice(0, 3)) as ReturnType<typeof customer>;
      const id = `D${++n}`;
      if (r() < 0.7) {
        const mode = r() < 0.5 ? "now" : "schedule";
        const category = pick(CATS);
        const scheduledAt = mode === "schedule" && r() < 0.7 ? now + int(1, 48) * 3_600_000 : null;
        const quote = quoteFee(category, DEFAULT_DETAILS, undefined, scheduledAt ?? now);
        const range = priceRange(quote.total, scheduledAt ?? now);
        record(
          createErrand(
            {
              id,
              title: "t",
              description: "",
              category,
              mode,
              scheduledAt,
              address: "a",
              itemBudget: pick([0, 0, 500, 38000, int(0, 200) * 500]),
              // the customer names any price ≥ the minimum (bargaining has no upper cap)
              fee: r() < 0.5 ? range.min + int(0, (range.max - range.min) / 500) * 500 : range.min + int(0, 60) * 500,
              customerId: c.id,
              // some go straight to one helper first (direct requests)
              invite: r() < 0.25 ? { helperId: pick(["h1", "h2", "h3"]), openAfter: r() < 0.5 } : null,
            },
            { now, actor: c },
          ),
        );
      } else {
        record(
          createGoods(
            { id, title: "item", price: int(1, 3000) * 1000, checkHours: pick([24, 72]), sellerId: c.id, code: generateDealCode() },
            { now, actor: c },
          ),
        );
      }
      continue;
    }

    if (roll < 0.1) {
      for (const d of [...deals.values()]) {
        const t = runDue(d, now);
        if (t) record(t);
      }
      continue;
    }

    const all = [...deals.values()];
    const active = all.filter((d) => !TERMINAL_STATUSES.includes(d.status));
    // tasks mid-job are rare in a random walk; visit them often so price changes run to the end
    const working = active.filter((d) => d.status === "matched" || d.status === "in_progress");
    const deal = working.length && r() < 0.3 ? pick(working) : pick(active.length && r() < 0.9 ? active : all);
    const byId = (id: string | null) => users.find((u) => u.kind === "user" && u.id === id);
    const cmds: Command[] = [
      { type: "confirm_payment", providerRef: r() < 0.3 ? `ref-${deal.id}` : `ref-${int(0, 1e6)}`, amount: r() < 0.9 ? amountDue(deal) : 1 },
      { type: "claim" },
      { type: "accept" },
      { type: "apply", note: "" },
      { type: "choose", helperId: pick(["h1", "h2", "h3"]) },
      { type: "cancel" },
      { type: "expire" },
      { type: "start" },
      { type: "record_receipt", amount: int(0, 250) * 200 },
      { type: "record_handover" },
      { type: "finish" },
      { type: "handover" },
      { type: "confirm" },
      { type: "dispute", reason: "x" },
      { type: "resolve", outcome: pick(["release", "refund"] as const) },
      { type: "auto_release" },
      // bargaining and price changes
      { type: "apply", note: "", price: int(10, 60) * 500 },
      { type: "counter", helperId: pick(["h1", "h2", "h3"]), price: int(10, 60) * 500 },
      { type: "reprice", price: int(10, 60) * 500 },
      { type: "accept_counter" },
      { type: "set_price", price: int(10, 60) * 500 },
      { type: "withdraw_offer" },
      { type: "propose_price", price: deal.type === "errand" ? Math.max(500, deal.fee + (r() < 0.5 ? -1 : 1) * int(1, 8) * 500) : 10000 },
      { type: "answer_price", accept: r() < 0.6 },
      { type: "withdraw_price" },
      {
        type: "confirm_price",
        providerRef: `pc-${int(0, 1e6)}`,
        amount: deal.type === "errand" && deal.priceChange ? (r() < 0.9 ? deal.priceChange.fee - deal.fee : 1) : 1,
      },
      // direct requests
      { type: "decline_invite" },
      { type: "open_to_all" },
    ];
    // a pending price change gets answered / paid often enough to finish its paths
    const pc = deal.type === "errand" ? deal.priceChange : null;
    const cmd =
      pc?.status === "proposed" && r() < 0.3
        ? cmds.find((c) => c.type === "answer_price")!
        : pc?.status === "awaiting_payment" && r() < 0.3
          ? cmds.find((c) => c.type === "confirm_price")!
          : pick(cmds);
    // 70% of the time pick the actor who could legitimately send this command, so long
    // happy paths actually complete; otherwise a random actor to exercise rejections.
    const payer = deal.type === "errand" ? deal.customerId : deal.buyerId;
    const worker = deal.type === "errand" ? deal.helperId : deal.sellerId;
    const plausible: Partial<Record<Command["type"], Actor | undefined>> = {
      confirm_payment: provider,
      claim: pick(users.slice(0, 3)),
      accept: pick(users.slice(3, 6)),
      apply: pick(users.slice(3, 6)),
      choose: byId(payer),
      cancel: byId(r() < 0.5 ? payer : worker),
      expire: { kind: "system" },
      start: byId(worker),
      record_receipt: byId(worker),
      record_handover: byId(worker),
      finish: byId(worker),
      handover: byId(worker),
      confirm: byId(payer),
      dispute: byId(payer),
      resolve: admin(),
      auto_release: { kind: "system" },
      counter: byId(payer),
      reprice: pick(users.slice(3, 6)),
      accept_counter: pick(users.slice(3, 6)),
      set_price: byId(payer),
      withdraw_offer: pick(users.slice(3, 6)),
      propose_price: byId(r() < 0.5 ? payer : worker),
      answer_price: byId(pc ? (pc.by === "customer" ? worker : payer) : payer), // the other side answers
      withdraw_price: byId(r() < 0.5 ? payer : worker),
      confirm_price: provider,
      decline_invite: deal.type === "errand" && deal.invite ? byId(deal.invite.helperId) : undefined,
      open_to_all: byId(payer),
    };
    const actor = (r() < 0.7 && plausible[cmd.type]) || pick(users);
    try {
      const t = apply(deal, cmd, { now, actor });
      // Direct requests: while one stands, nobody else gets onto the task (apply / accept / chosen).
      const only = deal.type === "errand" ? invitedOnly(deal, now) : null;
      if (only !== null && t.deal.type === "errand" && deal.type === "errand") {
        const newcomers = t.deal.offers.filter((o) => !deal.offers.some((x) => x.helperId === o.helperId)).map((o) => o.helperId);
        if (t.deal.helperId && t.deal.helperId !== deal.helperId) newcomers.push(t.deal.helperId);
        for (const h of newcomers) if (h !== only) throw new Error(`seed ${seed} step ${i}: ${h} got onto a task sent only to ${only}`);
        invitesChecked++;
      }
      record(t);
    } catch (e) {
      if (!(e instanceof EngineError)) throw e;
      expect(e.code).not.toBe("INVARIANT_BROKEN");
    }

    const v = checkInvariants([...deals.values()], ledger);
    if (v.length) throw new Error(`seed ${seed} step ${i} ${cmd.type}: ${JSON.stringify(v)}`);
  }
  return { deals: [...deals.values()], ledger, applied, invitesChecked };
}

describe("random simulation", () => {
  // CI runs 10 seeds; SIM_SEEDS=200 for a deep run before a release
  const extra = Array.from({ length: Math.max(0, Number(process.env.SIM_SEEDS ?? 10) - 10) }, (_, i) => 10_000 + i);
  for (const seed of [1, 2, 3, 42, 2026, 7, 99, 1234, 31337, 777, ...extra]) {
    it(`seed ${seed}: money always balances`, () => {
      const { deals, ledger, applied, invitesChecked } = simulate(seed, 4000);
      expect(applied).toBeGreaterThan(200);
      invitesSeen += invitesChecked;
      expect(checkInvariants(deals, ledger)).toEqual([]);

      // Double-entry: all balances across all accounts sum to zero.
      const accounts = new Set(ledger.flatMap((e) => [e.from, e.to]));
      expect([...accounts].reduce((a, acc) => a + balanceOf(ledger, acc), 0)).toBe(0);

      for (const d of deals) {
        const mine = ledger.filter((e) => e.dealId === d.id);
        // One first pay-in, plus one per paid price change / top-up — each a different provider
        // payment, never the same one twice; and at most one release per deal.
        const payIns = mine.filter((e) => e.kind === "pay_in");
        expect(new Set(payIns.map((e) => e.providerRef)).size, `deal ${d.id} pay-in refs`).toBe(payIns.length);
        const extraPaid = d.type === "errand" ? payIns.length - 1 : 0;
        expect(extraPaid <= 0 || (d.type === "errand" && d.providerRefs.length === payIns.length), `deal ${d.id} extra pay-ins`).toBe(true);
        if (d.type === "goods") expect(payIns.length).toBeLessThanOrEqual(1);
        expect(mine.filter((e) => e.kind === "release_fee" || e.kind === "release_seller").length).toBeLessThanOrEqual(1);

        const payer = d.type === "errand" ? d.customerId : d.buyerId;
        if (!payer) continue;
        const payerNet = balanceOf(mine, ext(payer));
        const cancelFee = mine.filter((e) => e.kind === "cancel_fee").reduce((a, e) => a + e.amount, 0);
        // Refund paths: the payer loses nothing except a post-match cancellation fee.
        if (d.status === "refunded" || d.status === "expired" || d.status === "cancelled") {
          expect(payerNet + cancelFee).toBe(0);
        }
        if (d.status === "released") expect(payerNet).toBeLessThan(0);
      }
      for (const d of deals) reached.add(d.status);
    });
  }

  // Guards against the walk becoming too random to be meaningful.
  const reached = new Set<string>();
  let invitesSeen = 0;
  it("across all seeds, exercises bargaining and direct requests", () => {
    expect(invitesSeen).toBeGreaterThan(0); // steps taken while a direct request stood were checked
    // (price changes after matching get their own walk in price-change-fuzz.test.ts)
    for (const code of ["offer_priced", "price_changed", "invite_sent", "invite_declined", "invite_opened"]) {
      expect(seenEvents, code).toContain(code);
    }
  });
  it("across all seeds, reaches every closing status", () => {
    for (const s of ["released", "refunded", "cancelled", "expired"]) expect(reached).toContain(s);
  });
});
