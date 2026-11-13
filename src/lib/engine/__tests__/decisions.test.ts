/** Rules decided 2026-11-13 (docs/decisions.md): round trip, budget buffer, over-budget top-up. */
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, DEFAULT_DETAILS, MINUTE_MS, autoPickAt, ext, heldItemBudget, payable, quoteFee, type ErrandDeal } from "../index";
import { T0, World, customer, helper, provider, system } from "./helpers";

const c1 = customer("c1");
const h1 = helper("h1");

describe("round trip (Буцаж ирэх)", () => {
  it("adds half the distance part, rounded to the fee step", () => {
    // deliver base 5000 + 4 km × 1500 = 11000; return leg 50% of 6000 = 3000
    const q = quoteFee("deliver", { ...DEFAULT_DETAILS, km: 4, roundTrip: true });
    expect(q.base).toBe(11000);
    expect(q.lines).toEqual([{ key: "roundTrip", amount: 3000 }]);
    expect(q.total).toBe(14000);
    // 2.5 km → 3750 × 50% = 1875 → rounds to 2000
    expect(quoteFee("deliver", { ...DEFAULT_DETAILS, km: 2.5, roundTrip: true }).lines).toEqual([{ key: "roundTrip", amount: 2000 }]);
  });

  it("costs nothing without a distance, and the engine drops the flag", () => {
    expect(quoteFee("queue", { ...DEFAULT_DETAILS, km: 0, roundTrip: true }).lines).toEqual([]);
    const w = new World();
    const id = w.post({ category: "queue", fee: 8000, itemBudget: 0, details: { km: 0, roundTrip: true } });
    expect((w.get(id) as ErrandDeal).details.roundTrip).toBe(false);
  });

  it("is part of the system price: a fee below it is rejected", () => {
    const w = new World();
    expect(() => w.post({ category: "deliver", fee: 11000, itemBudget: 0, details: { km: 4, roundTrip: true } })).toThrow(
      "Minimum fee is ₮14000",
    );
    w.post({ category: "deliver", fee: 14000, itemBudget: 0, details: { km: 4, roundTrip: true } });
  });
});

describe("budget buffer (+10%)", () => {
  it("holds budget + 10% and refunds whatever is unused", () => {
    expect(heldItemBudget(50000, true)).toBe(55000);
    expect(heldItemBudget(50000, false)).toBe(50000);
    expect(heldItemBudget(0, true)).toBe(0);

    const w = new World();
    const id = w.post({ itemBudget: 50000, fee: 9000, details: { budgetBuffer: true } });
    const d = w.get(id) as ErrandDeal;
    expect(d.itemBudget).toBe(55000);
    w.do(id, { type: "accept" }, h1);
    w.pay(id);
    expect(w.get(id).heldAmount).toBe(55000 + 9000 + DEFAULT_CONFIG.serviceFee);
    w.do(id, { type: "start" }, h1);
    // 4% over the typed budget: inside the buffer, no top-up needed
    w.do(id, { type: "record_receipt", amount: 52000 }, h1);
    expect((w.get(id) as ErrandDeal).topUp).toBeNull();
    w.do(id, { type: "record_handover" }, h1);
    w.do(id, { type: "finish" }, h1);
    w.do(id, { type: "confirm" }, c1);
    expect(w.bal(ext("c1"))).toBe(-65000 + 3000);
    expect(w.bal(payable("h1"))).toBe(8100 + 52000);
  });
});

describe("receipt over budget → top-up", () => {
  function inProgress(w: World) {
    const id = w.post({ itemBudget: 50000, fee: 9000 });
    w.do(id, { type: "accept" }, h1);
    w.pay(id);
    w.do(id, { type: "start" }, h1);
    return id;
  }

  it("approve: second held payment, helper is reimbursed the full receipt", () => {
    const w = new World();
    const id = inProgress(w);
    w.do(id, { type: "record_receipt", amount: 54500 }, h1);
    let d = w.get(id) as ErrandDeal;
    expect(d.topUp).toMatchObject({ amount: 4500, status: "pending" });
    w.do(id, { type: "record_handover" }, h1);
    w.reject(id, { type: "finish" }, h1, "ILLEGAL_TRANSITION"); // waiting for the customer

    w.reject(id, { type: "confirm_topup", providerRef: "tu1", amount: 4000 }, provider, "PAYMENT_MISMATCH");
    w.reject(id, { type: "confirm_topup", providerRef: "tu1", amount: 4500 }, c1, "FORBIDDEN"); // never on the customer's word
    w.do(id, { type: "confirm_topup", providerRef: "tu1", amount: 4500 }, provider);
    d = w.get(id) as ErrandDeal;
    expect(d.itemBudget).toBe(54500);
    expect(d.heldAmount).toBe(54500 + 9000 + 1000);
    expect(d.topUp).toMatchObject({ status: "paid", providerRef: "tu1" });

    // replayed webhook: no-op
    const before = w.get(id).version;
    w.do(id, { type: "confirm_topup", providerRef: "tu1", amount: 4500 }, provider);
    expect(w.get(id).version).toBe(before);

    w.do(id, { type: "finish" }, h1);
    w.do(id, { type: "confirm" }, c1);
    expect(w.bal(payable("h1"))).toBe(8100 + 54500);
    expect(w.bal(ext("c1"))).toBe(-60000 - 4500);
    expect(w.codes(id)).toContain("topup_requested");
    expect(w.codes(id)).toContain("topup_paid");
  });

  it("decline: helper returns the items, keeps the task fee; the whole budget comes back", () => {
    const w = new World();
    const id = inProgress(w);
    w.do(id, { type: "record_receipt", amount: 54500 }, h1);
    w.reject(id, { type: "decline_topup" }, h1, "FORBIDDEN");
    w.do(id, { type: "decline_topup" }, c1);
    const d = w.get(id) as ErrandDeal;
    expect(d.topUp?.status).toBe("declined");
    expect(d.receiptAmount).toBeNull();
    w.do(id, { type: "record_handover" }, h1);
    w.do(id, { type: "finish" }, h1); // no receipt needed: items were returned
    w.do(id, { type: "confirm" }, c1);
    expect(w.bal(payable("h1"))).toBe(8100);
    expect(w.bal(ext("c1"))).toBe(-60000 + 50000);
  });

  it("helper can drop items instead: a receipt within budget replaces the request", () => {
    const w = new World();
    const id = inProgress(w);
    w.do(id, { type: "record_receipt", amount: 54500 }, h1);
    w.do(id, { type: "record_receipt", amount: 49000 }, h1);
    expect((w.get(id) as ErrandDeal).topUp).toBeNull();
    w.reject(id, { type: "confirm_topup", providerRef: "late", amount: 4500 }, provider, "ILLEGAL_TRANSITION");
  });

  it("helper cancelling after a paid top-up refunds both payments", () => {
    const w = new World();
    const id = inProgress(w);
    w.do(id, { type: "record_receipt", amount: 54500 }, h1);
    w.do(id, { type: "confirm_topup", providerRef: "tu1", amount: 4500 }, provider);
    w.do(id, { type: "cancel" }, h1);
    expect(w.get(id).status).toBe("cancelled");
    expect(w.bal(ext("c1"))).toBe(0);
  });

  it("only while the task is in progress", () => {
    const w = new World();
    const id = w.post({ itemBudget: 50000, fee: 9000 });
    w.do(id, { type: "accept" }, h1);
    w.pay(id);
    w.reject(id, { type: "decline_topup" }, c1, "ILLEGAL_TRANSITION");
  });
});

describe("customer chooses (applications on every task)", () => {
  const h2 = helper("h2");

  it("Instant task: helpers apply at the set price, the customer picks one", () => {
    const w = new World();
    const id = w.post();
    w.do(id, { type: "apply", note: "5 min away" }, h1);
    w.do(id, { type: "apply", note: "" }, h2);
    w.reject(id, { type: "apply", note: "", price: 20000 }, helper("h3"), "INVALID_INPUT"); // no haggling on Instant
    w.reject(id, { type: "choose", helperId: "h1" }, h2, "FORBIDDEN");
    w.do(id, { type: "choose", helperId: "h2" }, c1);
    expect(w.get(id)).toMatchObject({ status: "awaiting_payment", helperId: "h2", fee: 10000 });
    w.pay(id);
    expect(w.get(id).status).toBe("matched");
  });

  it("Instant applications lapse after 15 min; the helper may apply again", () => {
    const w = new World();
    const id = w.post({ scheduledAt: T0 + 5 * 60 * MINUTE_MS }); // keeps the task open long enough
    w.do(id, { type: "apply", note: "" }, h1);
    w.now += 15 * MINUTE_MS;
    w.reject(id, { type: "choose", helperId: "h1" }, c1, "INVALID_INPUT");
    w.do(id, { type: "apply", note: "still free" }, h1);
    w.do(id, { type: "choose", helperId: "h1" }, c1);
  });

  it("a helper can withdraw their application; the system can withdraw it once they're busy", () => {
    const w = new World();
    const id = w.post();
    w.do(id, { type: "apply", note: "" }, h1);
    w.do(id, { type: "apply", note: "" }, h2);
    w.do(id, { type: "withdraw_offer" }, h1);
    w.reject(id, { type: "withdraw_offer" }, h1, "INVALID_INPUT");
    w.do(id, { type: "withdraw_offer", helperId: "h2" }, system);
    expect((w.get(id) as ErrandDeal).offers).toEqual([]);
  });

  it("'Choose for me': the system may pick 3 min after the first application, never before or when off", () => {
    const w = new World();
    const id = w.post({ details: { autoPick: true } });
    w.do(id, { type: "apply", note: "" }, h1);
    expect(autoPickAt(w.get(id) as ErrandDeal, w.now)).toBe(T0 + 3 * MINUTE_MS);
    w.reject(id, { type: "choose", helperId: "h1" }, system, "ILLEGAL_TRANSITION");
    w.now += 3 * MINUTE_MS;
    w.do(id, { type: "choose", helperId: "h1" }, system);
    expect(w.codes(id)).toContain("chosen");

    const off = w.post();
    w.do(off, { type: "apply", note: "" }, h1);
    w.now += 10 * MINUTE_MS;
    w.reject(off, { type: "choose", helperId: "h1" }, system, "ILLEGAL_TRANSITION");
  });
});
