import { describe, expect, it } from "vitest";
import { DEAL_CODE_ALPHABET, ext, generateDealCode, payable, type GoodsDeal } from "../index";
import { World, admin, customer, helper } from "./helpers";

const seller = customer("c1");
const buyer = customer("c2");

function toHeld(w: World, price = 1_350_000, checkHours = 24) {
  const id = w.sell({ price, checkHours });
  w.do(id, { type: "claim" }, buyer);
  w.pay(id);
  return id;
}

describe("SafePay happy path", () => {
  it("buyer pays price + 1% → seller hands over → buyer confirms → seller gets price", () => {
    const w = new World();
    const id = toHeld(w);
    const d = w.get(id) as GoodsDeal;
    expect(d.status).toBe("held");
    expect(d.buyerFee).toBe(13500);
    expect(d.heldAmount).toBe(1_363_500);

    w.do(id, { type: "handover" }, seller);
    expect(w.get(id).status).toBe("check");
    w.do(id, { type: "confirm" }, buyer);
    expect(w.get(id).status).toBe("released");
    expect(w.bal(payable("c1"))).toBe(1_350_000);
    expect(w.bal("platform")).toBe(13500);
    expect(w.bal(ext("c2"))).toBe(-1_363_500);
  });

  it("works for a helper selling too (same engine, any user)", () => {
    const w = new World();
    const id = w.sell({ price: 50000 }, helper("h1"));
    w.do(id, { type: "claim" }, buyer);
    w.pay(id);
    expect(w.get(id).heldAmount).toBe(51000);
  });
});

describe("claiming a deal by code", () => {
  it("the seller can't buy their own item; a second buyer is refused; re-opening is a no-op", () => {
    const w = new World();
    const id = w.sell();
    w.reject(id, { type: "claim" }, seller, "FORBIDDEN");
    w.do(id, { type: "claim" }, buyer);
    w.reject(id, { type: "claim" }, customer("c3"), "FORBIDDEN");
    expect(w.do(id, { type: "claim" }, buyer).duplicate).toBe(true);
  });

  it("payment before a buyer has claimed is illegal", () => {
    const w = new World();
    const id = w.sell();
    w.reject(id, { type: "confirm_payment", providerRef: "q", amount: 1_363_500 }, { kind: "provider" }, "ILLEGAL_TRANSITION");
  });
});

describe("SafePay protection", () => {
  it("the seller cannot hand over before the bank confirms payment", () => {
    const w = new World();
    const id = w.sell();
    w.do(id, { type: "claim" }, buyer);
    w.reject(id, { type: "handover" }, seller, "ILLEGAL_TRANSITION");
  });

  it("only the seller can mark handed over; only the buyer can confirm", () => {
    const w = new World();
    const id = toHeld(w);
    w.reject(id, { type: "handover" }, buyer, "FORBIDDEN");
    w.do(id, { type: "handover" }, seller);
    w.reject(id, { type: "confirm" }, seller, "FORBIDDEN");
  });

  it("uses the seller-chosen 3-day window for auto-release", () => {
    const w = new World();
    const id = toHeld(w, 200000, 72);
    w.do(id, { type: "handover" }, seller);
    w.advance(24);
    expect(w.tick()).toBe(0);
    w.advance(47);
    expect(w.tick()).toBe(0);
    w.advance(1);
    expect(w.tick()).toBe(1);
    expect(w.get(id).status).toBe("released");
    expect(w.tick()).toBe(0);
  });

  it("seller cancels after payment → buyer gets the full amount back, fee included", () => {
    const w = new World();
    const id = toHeld(w);
    w.do(id, { type: "cancel" }, seller);
    expect(w.get(id).status).toBe("cancelled");
    expect(w.bal(ext("c2"))).toBe(0);
    w.reject(id, { type: "cancel" }, seller, "ILLEGAL_TRANSITION");
  });

  it("the seller cannot cancel once handed over; the buyer cannot cancel at all", () => {
    const w = new World();
    const id = toHeld(w);
    w.reject(id, { type: "cancel" }, buyer, "FORBIDDEN");
    w.do(id, { type: "handover" }, seller);
    w.reject(id, { type: "cancel" }, seller, "ILLEGAL_TRANSITION");
  });

  it("dispute → Ops refund returns price + buyer fee", () => {
    const w = new World();
    const id = toHeld(w);
    w.do(id, { type: "handover" }, seller);
    w.do(id, { type: "dispute", reason: "Not as described" }, buyer);
    w.advance(1000);
    expect(w.tick()).toBe(0);
    w.do(id, { type: "resolve", outcome: "refund" }, admin());
    expect(w.get(id).status).toBe("refunded");
    expect(w.bal(ext("c2"))).toBe(0);
    expect(w.bal(payable("c1"))).toBe(0);
  });
});

describe("createGoods validation", () => {
  it("rejects bad windows, codes and prices", () => {
    const w = new World();
    expect(() => w.sell({ checkHours: 48 })).toThrow(/Check window/);
    expect(() => w.sell({ code: "abc123" })).toThrow(/code/);
    expect(() => w.sell({ code: "OOOOOO" })).toThrow(/code/); // O is not in the alphabet
    expect(() => w.sell({ price: 999 })).toThrow(/at least/);
    expect(() => w.sell({ price: 1500.5 })).toThrow(/integer/);
  });
});

describe("generateDealCode", () => {
  it("produces 6 characters from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateDealCode();
      expect(code).toMatch(/^[A-Z2-9]{6}$/);
      for (const ch of code) expect(DEAL_CODE_ALPHABET).toContain(ch);
    }
    expect(generateDealCode(() => new Uint8Array([0, 1, 31, 32, 255, 8]))).toBe("AB9A9J");
  });
});
