import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, MINUTE_MS, EngineError, amountDue, apply, arriveBy, createErrand, dueCommand, helperLate, type ErrandDeal } from "../index";

/** 2026-11-24: "On my way", "Need more time?" (traffic) and customer no-show protection. */
const T0 = Date.UTC(2026, 10, 24, 3);
const customer = { kind: "user" as const, id: "c1", role: "customer" as const };
const helper = { kind: "user" as const, id: "h1", role: "helper" as const, helperApproved: true, categories: ["shop" as const] };
const system = { kind: "system" as const };
const cfg = { ...DEFAULT_CONFIG, serviceFeeBps: 0, arriveMinutes: 30, lateGraceMinutes: 10, maxDelayMinutes: 30, absentGraceMinutes: 10 };
const at = (min: number) => T0 + min * MINUTE_MS;
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as EngineError).code; } return "ok"; };

/** Shopping job: 10,000₮ fee + 20,000₮ budget, helper chosen at 1 min, paid at 2. */
function paid(): ErrandDeal {
  let d = createErrand({ id: "N1", title: "t", description: "d", category: "shop", mode: "now", address: "a", itemBudget: 20_000, fee: 10_000, customerId: "c1" }, { now: T0, actor: customer }, cfg).deal;
  d = apply(d, { type: "accept" }, { now: at(1), actor: helper }).deal as ErrandDeal;
  return apply(d, { type: "confirm_payment", providerRef: "p", amount: amountDue(d) }, { now: at(2), actor: { kind: "provider" } }).deal as ErrandDeal;
}

describe("on the way, and traffic", () => {
  it("'On my way' is recorded once; only the helper can say it", () => {
    const d = paid();
    expect(code(() => apply(d, { type: "on_my_way" }, { now: at(3), actor: customer }))).toBe("FORBIDDEN");
    const t = apply(d, { type: "on_my_way" }, { now: at(3), actor: helper });
    expect((t.deal as ErrandDeal).enRouteAt).toBe(at(3));
    expect(apply(t.deal, { type: "on_my_way" }, { now: at(4), actor: helper }).events).toEqual([]);
  });

  it("'Need more time?' moves arrive-by (no late mark), up to the Ops cap, and lets the customer cancel free", () => {
    let d = paid();
    expect(arriveBy(d)).toBe(at(31));
    d = apply(d, { type: "need_time", minutes: 15 }, { now: at(25), actor: helper }).deal as ErrandDeal;
    expect(arriveBy(d)).toBe(at(46));
    expect(helperLate(d, at(50))).toBe(false); // would have been late at 41 without the extra time
    expect(code(() => apply(d, { type: "need_time", minutes: 30 }, { now: at(30), actor: helper }))).toBe("INVALID_INPUT"); // over 30 in total
    const cancelled = apply(d, { type: "cancel" }, { now: at(30), actor: customer });
    expect(cancelled.ledger.some((l) => l.kind === "cancel_fee")).toBe(false);
    expect(cancelled.events.map((e) => e.code)).toContain("cancelled_after_delay");
  });

  it("already late: asking for more time is too late; the customer decides", () => {
    const d = paid();
    expect(code(() => apply(d, { type: "need_time", minutes: 15 }, { now: at(45), actor: helper }))).toBe("ILLEGAL_TRANSITION");
  });
});

describe("the customer isn't there", () => {
  function started(): ErrandDeal {
    let d = paid();
    d = apply(d, { type: "start" }, { now: at(20), actor: helper }).deal as ErrandDeal;
    return apply(d, { type: "record_receipt", amount: 18_500 }, { now: at(40), actor: helper }).deal as ErrandDeal;
  }

  it("the customer answers in time: nothing else happens", () => {
    let d = started();
    d = apply(d, { type: "customer_absent" }, { now: at(60), actor: helper }).deal as ErrandDeal;
    expect(dueCommand(d, at(65))).toBeNull();
    d = apply(d, { type: "customer_present" }, { now: at(65), actor: customer }).deal as ErrandDeal;
    expect(d.absentAt).toBeNull();
    expect(dueCommand(d, at(200))).toBeNull();
  });

  it("no answer: cancelled; the helper gets the trip fee and the shopping they paid for; the rest is refunded", () => {
    let d = started();
    d = apply(d, { type: "customer_absent" }, { now: at(60), actor: helper }).deal as ErrandDeal;
    expect(code(() => apply(d, { type: "absent_cancel" }, { now: at(65), actor: system }))).toBe("ILLEGAL_TRANSITION");
    expect(dueCommand(d, at(70))).toEqual({ type: "absent_cancel" });
    const t = apply(d, { type: "absent_cancel" }, { now: at(70), actor: system });
    expect(t.deal.status).toBe("cancelled");
    const sum = (kind: string) => t.ledger.filter((l) => l.kind === kind).reduce((a, l) => a + l.amount, 0);
    expect(sum("item_reimburse")).toBe(18_500);
    expect(sum("cancel_fee")).toBe(cfg.cancelFee);
    expect(t.deal.heldAmount).toBe(0); // everything left went back to the customer
    expect(sum("item_reimburse") + sum("cancel_fee") + t.ledger.filter((l) => l.kind.includes("refund")).reduce((a, l) => a + l.amount, 0)).toBe(d.heldAmount);
  });
});
