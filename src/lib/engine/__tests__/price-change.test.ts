import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type ErrandDeal } from "../index";
import { World, customer, helper, provider } from "./helpers";

const c1 = customer("c1");
const h1 = helper("h1");

/** A 10,000₮ task, matched with h1 and paid (held 11,000 = fee + flat 1,000 service fee). */
function matched() {
  const w = new World(DEFAULT_CONFIG);
  const id = w.post({ fee: 10000, itemBudget: 0 });
  w.do(id, { type: "apply", note: "" }, h1);
  w.do(id, { type: "choose", helperId: "h1" }, c1);
  w.pay(id);
  expect(w.get(id)).toMatchObject({ status: "matched", fee: 10000, heldAmount: 11000 });
  return { w, id };
}
const pc = (w: World, id: string) => (w.get(id) as ErrandDeal).priceChange;

describe("price change after matching (docs/decisions.md 2026-11-16)", () => {
  it("lower: the other side accepts and the difference is refunded at once", () => {
    const { w, id } = matched();
    w.do(id, { type: "propose_price", price: 8000 }, h1); // smaller job than expected
    expect(pc(w, id)).toMatchObject({ fee: 8000, from: 10000, by: "helper", status: "proposed" });
    w.reject(id, { type: "answer_price", accept: true }, h1, "FORBIDDEN"); // can't accept your own
    w.do(id, { type: "answer_price", accept: true }, c1);
    expect(w.get(id)).toMatchObject({ fee: 8000, heldAmount: 9000, priceChange: null });
    expect(w.bal("ext:c1")).toBe(-11000 + 2000);
  });

  it("higher: accepted, then it counts only once the customer pays the difference (webhook idempotent)", () => {
    const { w, id } = matched();
    w.do(id, { type: "start" }, h1);
    w.do(id, { type: "propose_price", price: 15000 }, h1); // turned out bigger
    w.do(id, { type: "answer_price", accept: true }, c1);
    expect(w.get(id)).toMatchObject({ fee: 10000, heldAmount: 11000 });
    expect(pc(w, id)).toMatchObject({ status: "awaiting_payment" });
    w.reject(id, { type: "propose_price", price: 12000 }, c1, "ILLEGAL_TRANSITION"); // pay or drop it first
    w.reject(id, { type: "confirm_price", providerRef: "p1", amount: 4000 }, provider, "PAYMENT_MISMATCH");
    w.do(id, { type: "confirm_price", providerRef: "p1", amount: 5000 }, provider);
    expect(w.get(id)).toMatchObject({ fee: 15000, heldAmount: 16000 });
    expect(w.do(id, { type: "confirm_price", providerRef: "p1", amount: 5000 }, provider).duplicate).toBe(true);
    // release pays the helper the new price; the invariant holds (World checks it every step)
    w.do(id, { type: "record_handover" }, h1);
    w.do(id, { type: "finish" }, h1);
    w.do(id, { type: "confirm" }, c1);
    expect(w.bal("payable:h1")).toBe(15000);
  });

  it("either side may answer with another price; declined or withdrawn proposals change nothing", () => {
    const { w, id } = matched();
    w.do(id, { type: "propose_price", price: 14000 }, h1);
    w.do(id, { type: "propose_price", price: 12000 }, c1); // the customer's answer replaces it
    expect(pc(w, id)).toMatchObject({ fee: 12000, by: "customer" });
    w.reject(id, { type: "withdraw_price" }, h1, "FORBIDDEN"); // not h1's proposal to withdraw
    w.do(id, { type: "answer_price", accept: false }, h1);
    expect(w.get(id)).toMatchObject({ fee: 10000, priceChange: null });
    w.do(id, { type: "propose_price", price: 9000 }, c1);
    w.do(id, { type: "withdraw_price" }, c1);
    expect(pc(w, id)).toBeNull();
    w.reject(id, { type: "propose_price", price: 10000 }, c1, "INVALID_INPUT"); // already the price
    w.reject(id, { type: "propose_price", price: 3000 }, c1, "INVALID_INPUT"); // under the minimum
    w.reject(id, { type: "propose_price", price: 12000 }, helper("h2"), "FORBIDDEN"); // outsiders can't
  });

  it("an unpaid increase blocks 'done'; cancelling refunds everything held", () => {
    const { w, id } = matched();
    w.do(id, { type: "start" }, h1);
    w.do(id, { type: "record_handover" }, h1);
    w.do(id, { type: "propose_price", price: 13000 }, h1);
    w.do(id, { type: "answer_price", accept: true }, c1);
    w.reject(id, { type: "finish" }, h1, "ILLEGAL_TRANSITION");
    w.do(id, { type: "withdraw_price" }, c1); // the customer doesn't pay after all
    w.do(id, { type: "finish" }, h1);
    expect(w.get(id)).toMatchObject({ status: "check", fee: 10000 });

    const second = matched();
    second.w.do(second.id, { type: "propose_price", price: 12000 }, c1);
    second.w.do(second.id, { type: "cancel" }, c1);
    expect(second.w.get(second.id)).toMatchObject({ status: "cancelled", heldAmount: 0, priceChange: null });
  });
});
