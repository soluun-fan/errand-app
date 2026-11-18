import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG,
  EngineError,
  MINUTE_MS,
  TERMINAL_STATUSES,
  amountDue,
  apply,
  balanceOf,
  checkInvariants,
  createErrand,
  ext,
  payable,
  type Actor,
  type Command,
  type EngineConfig,
  type ErrandDeal,
  type LedgerEntry,
} from "../index";

/** Fee-only payments (docs/decisions.md 2026-11-18 "Direct pay + wire.mn"). */
const cfg: EngineConfig = { ...DEFAULT_CONFIG, payMode: "direct" };
const T0 = Date.UTC(2026, 10, 20, 4);
const c1 = { kind: "user" as const, id: "c1", role: "customer" as const };
const h1 = { kind: "user" as const, id: "h1", role: "helper" as const, helperApproved: true, categories: ["shop" as const] };
const provider = { kind: "provider" as const };
const admin = { kind: "user" as const, id: "ops", role: "admin" as const };

function world(itemBudget = 0) {
  let now = T0;
  const ledger: LedgerEntry[] = [];
  let d = createErrand(
    { id: "D1", title: "t", description: "d", category: "shop", mode: "now", address: "a", itemBudget, fee: 20000, customerId: "c1" },
    { now, actor: c1 },
    cfg,
  ).deal as ErrandDeal;
  const step = (cmd: Command, actor: Actor, mins = 1) => {
    now += mins * MINUTE_MS;
    const t = apply(d, cmd, { now, actor });
    ledger.push(...t.ledger);
    d = t.deal as ErrandDeal;
    return t;
  };
  return { get: () => d, ledger, step };
}

describe("only our fee goes through the app", () => {
  it("is fixed at posting and asks only for the service fee", () => {
    const w = world(30000);
    expect(w.get().payMode).toBe("direct");
    w.step({ type: "accept" }, h1);
    expect(amountDue(w.get())).toBe(w.get().serviceFee);
    expect(() => w.step({ type: "confirm_payment", providerRef: "x", amount: 20000 + w.get().serviceFee }, provider)).toThrow(EngineError);
    w.step({ type: "confirm_payment", providerRef: "p1", amount: w.get().serviceFee }, provider);
    expect(w.get()).toMatchObject({ status: "matched", heldAmount: w.get().serviceFee });
  });

  it("on release the fee is ours and nothing is paid to the helper through the app", () => {
    const w = world();
    w.step({ type: "accept" }, h1);
    w.step({ type: "confirm_payment", providerRef: "p1", amount: amountDue(w.get()) }, provider);
    w.step({ type: "start" }, h1);
    w.step({ type: "record_handover" }, h1);
    w.step({ type: "finish" }, h1);
    w.step({ type: "confirm" }, c1);
    expect(w.get()).toMatchObject({ status: "released", heldAmount: 0 });
    expect(balanceOf(w.ledger, "platform")).toBe(w.get().serviceFee);
    expect(balanceOf(w.ledger, payable("h1"))).toBe(0);
    expect(checkInvariants([w.get()], w.ledger)).toEqual([]);
  });

  it("customer cancels after paying: the fee is kept, no cancellation fee to the helper", () => {
    const w = world();
    w.step({ type: "accept" }, h1);
    w.step({ type: "confirm_payment", providerRef: "p1", amount: amountDue(w.get()) }, provider);
    const t = w.step({ type: "cancel" }, c1);
    expect(w.get()).toMatchObject({ status: "cancelled", heldAmount: 0 });
    expect(t.events.map((e) => e.code)).toContain("fee_kept");
    expect(balanceOf(w.ledger, "platform")).toBe(w.get().serviceFee);
    expect(balanceOf(w.ledger, payable("h1"))).toBe(0);
  });

  it("helper backs out: the fee goes back to the customer, the task reopens", () => {
    const w = world();
    w.step({ type: "accept" }, h1);
    w.step({ type: "confirm_payment", providerRef: "p1", amount: amountDue(w.get()) }, provider);
    w.step({ type: "cancel" }, h1, 30);
    expect(w.get()).toMatchObject({ status: "open", heldAmount: 0 });
    expect(balanceOf(w.ledger, ext("c1"))).toBe(0); // paid the fee, got it back
  });

  it("an agreed price change simply counts (nothing more is charged); a receipt over budget asks for nothing", () => {
    const w = world(10000);
    w.step({ type: "accept" }, h1);
    w.step({ type: "confirm_payment", providerRef: "p1", amount: amountDue(w.get()) }, provider);
    w.step({ type: "propose_price", price: 25000 }, h1);
    w.step({ type: "answer_price", accept: true }, c1);
    expect(w.get()).toMatchObject({ fee: 25000, priceChange: null, heldAmount: w.get().serviceFee });
    w.step({ type: "start" }, h1);
    w.step({ type: "record_receipt", amount: 18000 }, h1);
    expect(w.get()).toMatchObject({ receiptAmount: 18000, topUp: null });
  });

  it("disputes: Ops refund returns the fee; Ops release keeps it", () => {
    for (const outcome of ["refund", "release"] as const) {
      const w = world();
      w.step({ type: "accept" }, h1);
      w.step({ type: "confirm_payment", providerRef: "p1", amount: amountDue(w.get()) }, provider);
      w.step({ type: "start" }, h1);
      w.step({ type: "record_handover" }, h1);
      w.step({ type: "finish" }, h1);
      w.step({ type: "dispute", reason: "not_done", note: "nothing was done at all" }, c1);
      w.step({ type: "resolve", outcome }, admin);
      expect(w.get().heldAmount).toBe(0);
      expect(balanceOf(w.ledger, "platform")).toBe(outcome === "release" ? w.get().serviceFee : 0);
      expect(checkInvariants([w.get()], w.ledger)).toEqual([]);
    }
  });
});

describe("random walk in the fee-only mode: money always balances", () => {
  const n = Number(process.env.FUZZ_SEEDS ?? 300);
  it(`${n} random jobs`, () => {
    const cmds = (d: ErrandDeal): [Command, Actor][] => [
      [{ type: "accept" }, h1],
      [{ type: "confirm_payment", providerRef: `p${Math.random()}`, amount: amountDue(d) }, provider],
      [{ type: "propose_price", price: 15000 + Math.floor(Math.random() * 20) * 500 }, Math.random() < 0.5 ? c1 : h1],
      [{ type: "answer_price", accept: Math.random() < 0.7 }, Math.random() < 0.5 ? c1 : h1],
      [{ type: "start" }, h1],
      [{ type: "record_receipt", amount: Math.floor(Math.random() * 60) * 500 }, h1],
      [{ type: "record_handover" }, h1],
      [{ type: "finish" }, h1],
      [{ type: "confirm" }, c1],
      [{ type: "cancel" }, Math.random() < 0.5 ? c1 : h1],
      [{ type: "dispute", reason: "not_done", note: "it was not done properly" }, c1],
      [{ type: "resolve", outcome: Math.random() < 0.5 ? "release" : "refund" }, admin],
    ];
    for (let seed = 0; seed < n; seed++) {
      const w = world(Math.random() < 0.5 ? 0 : 20000);
      for (let i = 0; i < 40 && !TERMINAL_STATUSES.includes(w.get().status); i++) {
        const list = cmds(w.get());
        const [cmd, actor] = list[Math.floor(Math.random() * list.length)];
        try {
          w.step(cmd, actor, Math.floor(Math.random() * 20));
        } catch (e) {
          if (!(e instanceof EngineError)) throw e;
          expect(e.code).not.toBe("INVARIANT_BROKEN");
        }
        expect(checkInvariants([w.get()], w.ledger)).toEqual([]);
        // the app never holds more than our fee, and never pays a helper
        expect(w.get().heldAmount).toBeLessThanOrEqual(w.get().serviceFee);
        expect(balanceOf(w.ledger, payable("h1"))).toBe(0);
      }
    }
  });
});
