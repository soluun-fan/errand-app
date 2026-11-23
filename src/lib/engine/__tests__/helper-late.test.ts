import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, EngineError, MINUTE_MS, amountDue, apply, arriveBy, createErrand, helperLate, type EngineConfig, type ErrandDeal } from "../index";

/** Helper standards (docs/decisions.md 2026-11-22): late helpers, free cancel, replace. */
const T0 = Date.UTC(2026, 10, 22, 2);
const customer = { kind: "user" as const, id: "c1", role: "customer" as const };
const helper = { kind: "user" as const, id: "h1", role: "helper" as const, helperApproved: true, categories: ["shop" as const] };
const system = { kind: "system" as const };
const provider = { kind: "provider" as const };
const cfg: EngineConfig = { ...DEFAULT_CONFIG, arriveMinutes: 30, lateGraceMinutes: 10 };

/** Posted at T0, taken at T0 + 1 min, paid at T0 + 2 min. Arrive by T0 + 31 min, late after T0 + 41. */
function paid(): ErrandDeal {
  let d = createErrand({ id: "L1", title: "t", description: "d", category: "shop", mode: "now", address: "a", itemBudget: 5000, fee: 8000, customerId: "c1" }, { now: T0, actor: customer }, cfg).deal;
  d = apply(d, { type: "accept" }, { now: T0 + MINUTE_MS, actor: helper }).deal as ErrandDeal;
  return apply(d, { type: "confirm_payment", providerRef: "p1", amount: amountDue(d) }, { now: T0 + 2 * MINUTE_MS, actor: provider }).deal as ErrandDeal;
}
const at = (min: number) => T0 + min * MINUTE_MS;
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as EngineError).code; } return "ok"; };

describe("a paid helper who doesn't come", () => {
  it("arrive-by is the chosen time + the task's minutes; late only after the grace", () => {
    const d = paid();
    expect(arriveBy(d)).toBe(at(31));
    expect(helperLate(d, at(41))).toBe(false);
    expect(helperLate(d, at(41) + 1)).toBe(true);
  });

  it("a started job is never late, and the system marks lateness only when it is true", () => {
    const d = paid();
    expect(code(() => apply(d, { type: "mark_late" }, { now: at(40), actor: system }))).toBe("ILLEGAL_TRANSITION");
    expect(code(() => apply(d, { type: "mark_late" }, { now: at(50), actor: customer }))).not.toBe("ok");
    const t = apply(d, { type: "mark_late" }, { now: at(50), actor: system });
    expect(t.events.map((e) => e.code)).toEqual(["helper_late"]);
    expect(t.deal.status).toBe("matched");
    const started = apply(d, { type: "start" }, { now: at(20), actor: helper }).deal as ErrandDeal;
    expect(helperLate(started, at(500))).toBe(false);
  });

  it("the customer cancels free once the helper is late: no cancellation fee for the helper", () => {
    const d = paid();
    const onTime = apply(d, { type: "cancel" }, { now: at(20), actor: customer });
    expect(onTime.ledger.some((l) => l.kind === "cancel_fee")).toBe(true);
    const late = apply(d, { type: "cancel" }, { now: at(50), actor: customer });
    expect(late.ledger.some((l) => l.kind === "cancel_fee")).toBe(false);
    expect(late.deal.heldAmount).toBe(0);
    expect(late.events.map((e) => e.code)).toContain("helper_no_show");
  });

  it("…or gets another helper: everything is refunded and the task is open again without them", () => {
    const d = paid();
    expect(code(() => apply(d, { type: "replace_helper" }, { now: at(20), actor: customer }))).toBe("ILLEGAL_TRANSITION");
    expect(code(() => apply(d, { type: "replace_helper" }, { now: at(50), actor: helper }))).toBe("FORBIDDEN");
    const t = apply(d, { type: "replace_helper" }, { now: at(50), actor: customer });
    const e = t.deal as ErrandDeal;
    expect(e.status).toBe("open");
    expect(e.helperId).toBeNull();
    expect(e.heldAmount).toBe(0);
    expect(e.offers.some((o) => o.helperId === "h1")).toBe(false);
    expect(e.matchBy).toBeGreaterThan(at(50));
    expect(t.events.map((x) => x.code)).toEqual(expect.arrayContaining(["helper_no_show", "helper_replaced"]));
    expect(t.effects).toEqual([]); // not a back-out penalty: the record mark comes from the event
  });

  it("scheduled tasks are due at the booked time", () => {
    const later = T0 + 5 * 60 * MINUTE_MS;
    let d = createErrand({ id: "L2", title: "t", description: "d", category: "shop", mode: "schedule", scheduledAt: later, address: "a", itemBudget: 0, fee: 8000, customerId: "c1" }, { now: T0, actor: customer }, cfg).deal;
    d = apply(d, { type: "apply", note: "" }, { now: at(1), actor: helper }).deal as ErrandDeal;
    d = apply(d, { type: "choose", helperId: "h1" }, { now: at(2), actor: customer }).deal as ErrandDeal;
    expect(arriveBy(d)).toBe(later);
  });
});
