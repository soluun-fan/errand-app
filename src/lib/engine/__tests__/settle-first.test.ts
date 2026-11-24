import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, HOUR_MS, MINUTE_MS, EngineError, amountDue, apply, createErrand, dueCommand, type ErrandDeal } from "../index";

/** 2026-11-24 "settle it between you first": after "done", a partial refund by agreement. */
const T0 = Date.UTC(2026, 10, 24, 2);
const customer = { kind: "user" as const, id: "c1", role: "customer" as const };
const helper = { kind: "user" as const, id: "h1", role: "helper" as const, helperApproved: true, categories: ["queue" as const] };
const system = { kind: "system" as const };
const cfg = { ...DEFAULT_CONFIG, serviceFeeBps: 0 };
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as EngineError).code; } return "ok"; };

/** A 20,000₮ queue job, done and waiting for the customer's check (check window: the task's hours). */
function done(): ErrandDeal {
  let d = createErrand({ id: "S1", title: "t", description: "d", category: "queue", mode: "now", address: "a", itemBudget: 0, fee: 20_000, customerId: "c1" }, { now: T0, actor: customer }, cfg).deal;
  const run = (cmd: Parameters<typeof apply>[1], actor: Parameters<typeof apply>[2]["actor"], at: number) => (d = apply(d, cmd, { now: at, actor }).deal as ErrandDeal);
  run({ type: "accept" }, helper, T0 + MINUTE_MS);
  run({ type: "confirm_payment", providerRef: "p", amount: amountDue(d) }, { kind: "provider" }, T0 + 2 * MINUTE_MS);
  run({ type: "start" }, helper, T0 + 10 * MINUTE_MS);
  run({ type: "record_handover" }, helper, T0 + 60 * MINUTE_MS);
  run({ type: "finish" }, helper, T0 + 61 * MINUTE_MS);
  expect(d.status).toBe("check");
  return d;
}
const at = (h: number) => T0 + 61 * MINUTE_MS + h * HOUR_MS;

describe("after 'done', customer and helper can settle a problem themselves", () => {
  it("only a lower price can be offered (down to 0), by either side", () => {
    const d = done();
    expect(code(() => apply(d, { type: "propose_price", price: 25_000 }, { now: at(0.1), actor: customer }))).toBe("INVALID_INPUT");
    expect(code(() => apply(d, { type: "propose_price", price: 0 }, { now: at(0.1), actor: customer }))).toBe("ok");
    expect(code(() => apply(d, { type: "propose_price", price: 18_000 }, { now: at(0.1), actor: helper }))).toBe("ok");
  });

  it("accepted: the difference is refunded at once, the helper keeps the rest, the customer gets time to confirm", () => {
    let d = done();
    d = apply(d, { type: "propose_price", price: 15_000 }, { now: at(0.5), actor: customer }).deal as ErrandDeal;
    const t = apply(d, { type: "answer_price", accept: true }, { now: at(2), actor: helper });
    expect(t.ledger.find((l) => l.kind === "refund")?.amount).toBe(5_000);
    d = t.deal as ErrandDeal;
    expect(d.fee).toBe(15_000);
    expect(d.status).toBe("check");
    expect(d.checkUntil).toBe(at(2) + d.checkHours * HOUR_MS);
    const released = apply(d, { type: "confirm" }, { now: at(2.1), actor: customer }).deal as ErrandDeal;
    expect(released.status).toBe("released");
  });

  it("an open offer holds the auto-release; unanswered for 24 h it goes to Ops as a dispute", () => {
    let d = done();
    d = apply(d, { type: "propose_price", price: 10_000 }, { now: at(0.5), actor: customer }).deal as ErrandDeal;
    expect(dueCommand(d, at(10))).toBeNull(); // check window over, but an offer is waiting
    expect(code(() => apply(d, { type: "auto_release" }, { now: at(10), actor: system }))).toBe("ILLEGAL_TRANSITION");
    expect(dueCommand(d, at(24.6))).toEqual({ type: "escalate_offer" });
    const t = apply(d, { type: "escalate_offer" }, { now: at(24.6), actor: system });
    expect(t.deal.status).toBe("disputed");
    expect(t.deal.dispute?.reason).toBe("no_agreement");
    expect(t.events.map((e) => e.code)).toEqual(["offer_escalated", "disputed"]);
  });

  it("declined: nothing changes except a fresh window to confirm or report", () => {
    let d = done();
    d = apply(d, { type: "propose_price", price: 12_000 }, { now: at(2.5), actor: customer }).deal as ErrandDeal;
    d = apply(d, { type: "answer_price", accept: false }, { now: at(2.9), actor: helper }).deal as ErrandDeal;
    expect(d.fee).toBe(20_000);
    expect(d.priceChange).toBeNull();
    expect(dueCommand(d, at(3))).toBeNull(); // the customer has the window again
    expect(code(() => apply(d, { type: "dispute", reason: "quality" }, { now: at(3), actor: customer }))).toBe("ok");
  });
});
