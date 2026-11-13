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
  apply,
  balanceOf,
  checkInvariants,
  createErrand,
  createGoods,
  ext,
  generateDealCode,
  runDue,
  type Actor,
  type CategoryId,
  type Command,
  type Deal,
  type LedgerEntry,
  type Transition,
} from "../index";
import { T0, admin, customer, helper, provider } from "./helpers";

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

  const record = (t: Transition) => {
    deals.set(t.deal.id, t.deal);
    ledger.push(...t.ledger);
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
              fee: quote.total + int(0, 100) * 500, // the system price, sometimes raised
              customerId: c.id,
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
    const deal = pick(active.length && r() < 0.9 ? active : all);
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
    ];
    const cmd = pick(cmds);
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
    };
    const actor = (r() < 0.7 && plausible[cmd.type]) || pick(users);
    try {
      record(apply(deal, cmd, { now, actor }));
    } catch (e) {
      if (!(e instanceof EngineError)) throw e;
      expect(e.code).not.toBe("INVARIANT_BROKEN");
    }

    const v = checkInvariants([...deals.values()], ledger);
    if (v.length) throw new Error(`seed ${seed} step ${i} ${cmd.type}: ${JSON.stringify(v)}`);
  }
  return { deals: [...deals.values()], ledger, applied };
}

describe("random simulation", () => {
  for (const seed of [1, 2, 3, 42, 2026]) {
    it(`seed ${seed}: money always balances`, () => {
      const { deals, ledger, applied } = simulate(seed, 4000);
      expect(applied).toBeGreaterThan(200);
      expect(checkInvariants(deals, ledger)).toEqual([]);

      // Double-entry: all balances across all accounts sum to zero.
      const accounts = new Set(ledger.flatMap((e) => [e.from, e.to]));
      expect([...accounts].reduce((a, acc) => a + balanceOf(ledger, acc), 0)).toBe(0);

      for (const d of deals) {
        const mine = ledger.filter((e) => e.dealId === d.id);
        // At most one pay-in, and at most one release, per deal.
        expect(mine.filter((e) => e.kind === "pay_in").length).toBeLessThanOrEqual(1);
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
  it("across all seeds, reaches every closing status", () => {
    for (const s of ["released", "refunded", "cancelled", "expired"]) expect(reached).toContain(s);
  });
});
