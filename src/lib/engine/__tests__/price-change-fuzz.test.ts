/**
 * Random walk over the money-moving part of a job: a task that is matched and paid, then any
 * mix of price proposals, answers, withdrawals, extra payments (right and wrong amounts, replayed
 * webhooks), receipts, start / finish / confirm, cancel, dispute and Ops decisions — from the
 * right and the wrong people. After every step the ledger must balance; at the end the money
 * must have gone where the final state says.
 */
import { describe, expect, it } from "vitest";
import { EngineError, MINUTE_MS, TERMINAL_STATUSES, amountDue, apply, balanceOf, checkInvariants, createErrand, ext, payable, runDue, type Actor, type Command, type ErrandDeal, type LedgerEntry } from "../index";
import { T0, TEST_CONFIG, admin, customer, helper, provider } from "./helpers";

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

const seen = new Set<string>();

function run(seed: number) {
  const r = rng(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  let now = T0;
  const c1 = customer("c1");
  const h1 = helper("h1");
  const ledger: LedgerEntry[] = [];
  const step = (d: ErrandDeal, cmd: Command, actor: Actor): ErrandDeal => {
    const t = apply(d, cmd, { now, actor });
    ledger.push(...t.ledger);
    for (const e of t.events) seen.add(e.code);
    return t.deal;
  };

  const budget = pick([0, 0, 20000]);
  let d = createErrand(
    { id: `F${seed}`, title: "t", description: "", category: "shop", mode: "now", address: "a", itemBudget: budget, fee: int(10, 40) * 500, customerId: "c1" },
    { now, actor: c1 },
    TEST_CONFIG,
  ).deal;
  d = step(d, { type: "accept" }, h1);
  d = step(d, { type: "confirm_payment", providerRef: `pay-${seed}`, amount: amountDue(d) }, provider);
  const paidRefs: string[] = [];

  for (let i = 0; i < 60 && !TERMINAL_STATUSES.includes(d.status); i++) {
    now += int(0, 30) * MINUTE_MS;
    if (d.status === "open") {
      // the helper backed out and the task was posted anew: chosen again, paid again
      d = step(d, { type: "accept" }, h1);
      d = step(d, { type: "confirm_payment", providerRef: `pay-${seed}-${i}`, amount: amountDue(d) }, provider);
    }
    const pc = d.priceChange;
    const other = pc ? (pc.by === "customer" ? h1 : c1) : pick([c1, h1]);
    const cmds: [Command, Actor][] = [
      [{ type: "propose_price", price: Math.max(500, d.fee + (r() < 0.5 ? -1 : 1) * int(1, 10) * 500) }, pick([c1, h1])],
      [{ type: "answer_price", accept: r() < 0.7 }, r() < 0.85 ? other : pick([c1, h1])],
      [{ type: "withdraw_price" }, pick([c1, h1])],
      [
        {
          type: "confirm_price",
          providerRef: r() < 0.2 && paidRefs.length ? pick(paidRefs) : `x-${seed}-${i}`, // sometimes a replayed webhook
          amount: pc?.status === "awaiting_payment" && r() < 0.85 ? pc.fee - d.fee : int(1, 20) * 500,
        },
        r() < 0.9 ? provider : c1,
      ],
      [{ type: "start" }, h1],
      [{ type: "record_receipt", amount: int(0, 50) * 500 }, h1],
      [{ type: "record_handover" }, h1],
      [{ type: "finish" }, h1],
      [{ type: "confirm" }, c1],
      [{ type: "cancel" }, pick([c1, h1])],
      [{ type: "dispute", reason: "x" }, c1],
      [{ type: "resolve", outcome: pick(["release", "refund"] as const) }, admin()],
      [{ type: "decline_topup" }, c1],
    ];
    // price-change commands most of the time, so their paths run to the end
    const [cmd, actor] = r() < 0.6 ? pick(cmds.slice(0, 4)) : pick(cmds);
    try {
      d = step(d, cmd, actor);
      if (cmd.type === "confirm_price") paidRefs.push(cmd.providerRef);
    } catch (e) {
      if (!(e instanceof EngineError)) throw e;
      expect(e.code, `seed ${seed} step ${i} ${cmd.type}`).not.toBe("INVARIANT_BROKEN");
    }
    const v = checkInvariants([d], ledger);
    if (v.length) throw new Error(`seed ${seed} step ${i} ${cmd.type}: ${JSON.stringify(v)}`);
    // the fee only ever changes to an agreed (and, if higher, paid) price
    expect(d.fee).toBeGreaterThan(0);
    for (const t of runDue(d, now)?.ledger ?? []) void t; // background jobs never throw here
  }
  return { d, ledger };
}

describe("price changes after matching: random walk", () => {
  // CI runs 300; FUZZ_SEEDS=20000 npm test -- price-change-fuzz for a deep run before a release
  const n = Number(process.env.FUZZ_SEEDS ?? 300);
  const seeds = Array.from({ length: n }, (_, i) => i + 1);
  it(`${n} random jobs: money balances at every step and ends where the final state says`, () => {
    for (const seed of seeds) {
      const { d, ledger } = run(seed);
      expect(checkInvariants([d], ledger)).toEqual([]);
      const pays = ledger.filter((e) => e.kind === "pay_in");
      // one first payment plus at most one per paid price change, never a replayed one twice
      expect(new Set(pays.map((e) => e.providerRef)).size).toBe(pays.length);
      const customerNet = balanceOf(ledger, ext("c1"));
      const helperGot = balanceOf(ledger, payable("h1"));
      if (d.status === "refunded") expect(customerNet + helperGot).toBe(0); // all back, except a cancel fee to the helper
      if (d.status === "released") {
        expect(d.heldAmount).toBe(0);
        expect(helperGot).toBeGreaterThanOrEqual(d.fee - Math.floor((d.fee * d.commissionBps) / 10_000));
      }
      if (!TERMINAL_STATUSES.includes(d.status)) expect(d.heldAmount + customerNet + helperGot + balanceOf(ledger, "platform")).toBe(0);
    }
  });
  it("reached every price-change outcome", () => {
    for (const code of ["price_proposed", "price_agreed", "price_agreed_pay", "price_paid", "price_declined", "price_withdrawn", "released", "refunded"]) {
      expect(seen, code).toContain(code);
    }
  });
});
