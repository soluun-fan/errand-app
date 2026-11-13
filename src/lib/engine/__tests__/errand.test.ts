import { describe, expect, it } from "vitest";
import { HOUR_MS, MINUTE_MS, apply, createErrand, ext, payable, type ErrandDeal } from "../index";
import { T0, World, admin, customer, helper, provider, system } from "./helpers";

const c1 = customer("c1");
const h1 = helper("h1");
const h2 = helper("h2");

/** Posts a shopping errand with an item budget and takes it to the check window. */
function toCheck(w: World, opts: { receipt?: number } = {}) {
  const id = w.post({ itemBudget: 38000, fee: 9000 });
  w.pay(id);
  w.do(id, { type: "accept" }, h1);
  w.do(id, { type: "start" }, h1);
  w.do(id, { type: "record_receipt", amount: opts.receipt ?? 35500 }, h1);
  w.do(id, { type: "record_handover" }, h1);
  w.do(id, { type: "finish" }, h1);
  return id;
}

describe("errand happy path (Now)", () => {
  it("post → pay → accept → start → proof → done → confirm releases the exact split", () => {
    const w = new World();
    const id = toCheck(w);
    const d = w.get(id) as ErrandDeal;
    expect(d.status).toBe("check");
    expect(d.heldAmount).toBe(48000);
    expect(d.checkUntil).toBe(w.now + 24 * HOUR_MS);

    w.do(id, { type: "confirm" }, c1);
    expect(w.get(id).status).toBe("released");
    expect(w.get(id).heldAmount).toBe(0);
    expect(w.bal(payable("h1"))).toBe(9000 - 900 + 35500);
    expect(w.bal("platform")).toBe(1000 + 900);
    // customer paid 48000 and got 2500 unspent budget back
    expect(w.bal(ext("c1"))).toBe(-48000 + 2500);
    expect(w.bal("hold")).toBe(0);
    expect(w.codes(id)).toEqual([
      "posted",
      "paid",
      "helpers_notified",
      "accepted",
      "started",
      "receipt_recorded",
      "handover_recorded",
      "done",
      "released",
    ]);
  });

  it("is first-to-accept: a second helper is turned away", () => {
    const w = new World();
    const id = w.post();
    w.pay(id);
    w.do(id, { type: "accept" }, h1);
    w.reject(id, { type: "accept" }, h2, "ILLEGAL_TRANSITION");
    expect((w.get(id) as ErrandDeal).helperId).toBe("h1");
  });

  it("only lets approved helpers in the right category accept, never the customer", () => {
    const w = new World();
    const id = w.post({ category: "repair", fee: 15000 });
    w.pay(id);
    w.reject(id, { type: "accept" }, helper("h3", { helperApproved: false }), "FORBIDDEN");
    w.reject(id, { type: "accept" }, helper("h2", { categories: ["shop"] }), "FORBIDDEN");
    w.reject(id, { type: "accept" }, c1, "FORBIDDEN");
    w.reject(id, { type: "accept" }, helper("c1"), "FORBIDDEN"); // customer in helper mode
  });

  it("does not show tasks before payment: accept on awaiting_payment is illegal", () => {
    const w = new World();
    const id = w.post();
    w.reject(id, { type: "accept" }, h1, "ILLEGAL_TRANSITION");
  });
});

describe("scheduled errands", () => {
  it("takes up to 5 applicants, then the customer chooses one", () => {
    const w = new World();
    const id = w.post({ mode: "schedule", scheduledAt: T0 + 30 * HOUR_MS, category: "carry", fee: 40000 });
    w.pay(id);
    w.reject(id, { type: "accept" }, h1, "ILLEGAL_TRANSITION");
    for (let i = 1; i <= 5; i++) w.do(id, { type: "apply", note: "I can come" }, helper(`h${i}`));
    w.reject(id, { type: "apply", note: "me too" }, helper("h6"), "ILLEGAL_TRANSITION");
    w.reject(id, { type: "choose", helperId: "h6" }, c1, "INVALID_INPUT");
    w.reject(id, { type: "choose", helperId: "h3" }, helper("h3"), "FORBIDDEN");
    w.do(id, { type: "choose", helperId: "h3" }, c1);
    const d = w.get(id) as ErrandDeal;
    expect(d.status).toBe("matched");
    expect(d.helperId).toBe("h3");
  });

  it("rejects a duplicate application", () => {
    const w = new World();
    const id = w.post({ mode: "schedule", scheduledAt: T0 + 30 * HOUR_MS });
    w.pay(id);
    w.do(id, { type: "apply", note: "" }, h1);
    w.reject(id, { type: "apply", note: "" }, h1, "INVALID_INPUT");
  });

  it("expires at the scheduled time if nobody was chosen", () => {
    const w = new World();
    const id = w.post({ mode: "schedule", scheduledAt: T0 + 30 * HOUR_MS });
    w.pay(id);
    expect((w.get(id) as ErrandDeal).matchBy).toBe(T0 + 30 * HOUR_MS);
    w.advance(29);
    expect(w.tick()).toBe(0);
    w.advance(1);
    expect(w.tick()).toBe(1);
    expect(w.get(id).status).toBe("expired");
  });

  it("refuses a scheduled time in the past", () => {
    expect(() =>
      createErrand(
        {
          id: "X",
          title: "t",
          description: "",
          category: "shop",
          mode: "schedule",
          scheduledAt: T0 - 1,
          address: "a",
          itemBudget: 0,
          fee: 5000,
          customerId: "c1",
        },
        { now: T0, actor: c1 },
      ),
    ).toThrow(/future/);
  });
});

describe("UI-FLOWS rules", () => {
  it("an unpaid task expires after 30 minutes, with no money moved", () => {
    const w = new World();
    const id = w.post();
    expect((w.get(id) as ErrandDeal).payBy).toBe(T0 + 30 * MINUTE_MS);
    w.now += 29 * MINUTE_MS;
    expect(w.tick()).toBe(0);
    w.now += MINUTE_MS;
    expect(w.tick()).toBe(1);
    expect(w.get(id).status).toBe("expired");
    expect(w.codes(id)).toEqual(["posted", "payment_expired"]);
    expect(w.ledger).toEqual([]);
    // a late bank confirmation is rejected (the provider must refund it)
    w.reject(id, { type: "confirm_payment", providerRef: "late", amount: 11000 }, provider, "ILLEGAL_TRANSITION");
  });

  it("a paid task does not expire on the payment window", () => {
    const w = new World();
    const id = w.post();
    w.pay(id);
    w.do(id, { type: "accept" }, h1);
    w.advance(5);
    expect(w.tick()).toBe(0);
    expect(w.get(id).status).toBe("matched");
  });

  it("applies the ₮6,000 night minimum to tasks starting 22:00–07:00 Ulaanbaatar time", () => {
    const w = new World();
    // T0 is 16:00 in Ulaanbaatar; 22:00 UB = 14:00 UTC
    const night = Date.UTC(2026, 10, 12, 14, 0);
    const morning = Date.UTC(2026, 10, 12, 23, 0); // 07:00 UB next day
    const deliver = { category: "deliver" as const }; // base 5,000 = the day minimum
    expect(() => w.post({ ...deliver, scheduledAt: night, fee: 5500 })).toThrow(/Minimum fee is ₮6000/);
    expect(() => w.post({ ...deliver, scheduledAt: night, fee: 6000 })).not.toThrow();
    expect(() => w.post({ ...deliver, scheduledAt: morning, fee: 5000 })).not.toThrow();
    w.now = night + HOUR_MS; // posting "Now" at 23:00 UB
    expect(() => w.post({ ...deliver, fee: 5000 })).toThrow(/Minimum fee is ₮6000/);
  });

  it("limits title to 40 and description to 500 characters, and keeps the pickup address", () => {
    const w = new World();
    expect(() => w.post({ title: "x".repeat(41) })).toThrow(/40/);
    expect(() => w.post({ description: "x".repeat(501) })).toThrow(/500/);
    const id = w.post({ pickupAddress: "  Nomin supermarket, Zaisan  " });
    expect((w.get(id) as ErrandDeal).pickupAddress).toBe("Nomin supermarket, Zaisan");
    expect((w.get(w.post()) as ErrandDeal).pickupAddress).toBeNull();
  });
});

describe("instant price (quoteFee)", () => {
  it("rejects a fee below the system price; raising it is fine", () => {
    const w = new World();
    // carry base 15,000; 5th floor, no lift, helper carries: +4 × 1,500
    const details = { floor: 5, lift: "no" as const, carryByHelper: true };
    expect(() => w.post({ category: "carry", fee: 20000, details })).toThrow(/Minimum fee is ₮21000/);
    expect(() => w.post({ category: "carry", fee: 21000, details })).not.toThrow();
    expect(() => w.post({ category: "carry", fee: 30000, details })).not.toThrow();
    // customer brings it down: no stairs add-on
    expect(() => w.post({ category: "carry", fee: 15000, details: { ...details, carryByHelper: false } })).not.toThrow();
  });

  it("heavy item, no lift, above the 2nd floor needs 2 people (+15,000)", () => {
    const w = new World();
    const details = { floor: 5, lift: "no" as const, heavy: true, carryByHelper: true };
    expect(() => w.post({ category: "carry", fee: 50000, details })).toThrow(/2 people/);
    const id = w.post({ category: "carry", fee: 36000, details: { ...details, people: 2 } });
    expect((w.get(id) as ErrandDeal).details).toMatchObject({ floor: 5, people: 2, heavy: true });
    expect(() => w.post({ category: "carry", fee: 50000, details: { ...details, lift: "yes" } })).not.toThrow();
  });

  it("rejects nonsense details", () => {
    const w = new World();
    expect(() => w.post({ details: { floor: -1 } })).toThrow(/Floor/);
    expect(() => w.post({ details: { km: 500 } })).toThrow(/Distance/);
    expect(() => w.post({ details: { people: 3 as 1 } })).toThrow(/People/);
  });

  it("an instant task can be scheduled; the no-helper deadline is the scheduled time", () => {
    const w = new World();
    const id = w.post({ scheduledAt: T0 + 5 * HOUR_MS });
    w.pay(id);
    expect((w.get(id) as ErrandDeal).matchBy).toBe(T0 + 5 * HOUR_MS);
  });
});

describe("posting rules", () => {
  it("enforces the minimum fee and integer money", () => {
    const w = new World();
    expect(() => w.post({ fee: 4999 })).toThrow(/Minimum fee/);
    expect(() => w.post({ fee: 5000.5 })).toThrow(/integer/);
    expect(() => w.post({ itemBudget: -100 })).toThrow(/integer/);
    expect(() => w.post({ customerId: "c2" }, c1)).toThrow(/yourself/);
  });

  it("snapshots fee terms so later config changes don't affect the deal", () => {
    const w = new World();
    const id = w.post();
    const d = w.get(id) as ErrandDeal;
    expect(d).toMatchObject({ serviceFee: 1000, commissionBps: 1000, cancelFee: 3000, checkHours: 24, maxApplicants: 5 });
  });
});

describe("payment webhook", () => {
  it("is idempotent: the same provider event twice moves money once", () => {
    const w = new World();
    const id = w.post();
    w.pay(id, "qpay-123");
    const again = w.do(id, { type: "confirm_payment", providerRef: "qpay-123", amount: 11000 }, provider);
    expect(again.duplicate).toBe(true);
    expect(again.ledger).toEqual([]);
    expect(w.bal("hold")).toBe(11000);
    // still idempotent after the deal has moved on
    w.do(id, { type: "accept" }, h1);
    expect(w.do(id, { type: "confirm_payment", providerRef: "qpay-123", amount: 11000 }, provider).duplicate).toBe(true);
  });

  it("rejects a second, different payment for an already-paid deal", () => {
    const w = new World();
    const id = w.post();
    w.pay(id, "qpay-1");
    w.reject(id, { type: "confirm_payment", providerRef: "qpay-2", amount: 11000 }, provider, "ILLEGAL_TRANSITION");
  });

  it("rejects wrong amounts and anyone but the provider (no screenshots)", () => {
    const w = new World();
    const id = w.post();
    w.reject(id, { type: "confirm_payment", providerRef: "q", amount: 10999 }, provider, "PAYMENT_MISMATCH");
    w.reject(id, { type: "confirm_payment", providerRef: "q", amount: 11000 }, c1, "FORBIDDEN");
    w.reject(id, { type: "confirm_payment", providerRef: "q", amount: 11000 }, system, "FORBIDDEN");
    // a replayed ref from a user is still forbidden, not silently accepted
    w.pay(id, "q");
    w.reject(id, { type: "confirm_payment", providerRef: "q", amount: 11000 }, c1, "FORBIDDEN");
  });
});

describe("proof before done", () => {
  it("needs a handover photo, and a receipt when there is an item budget", () => {
    const w = new World();
    const id = w.post({ itemBudget: 20000 });
    w.pay(id);
    w.do(id, { type: "accept" }, h1);
    w.do(id, { type: "start" }, h1);
    w.reject(id, { type: "finish" }, h1, "PROOF_MISSING");
    w.do(id, { type: "record_handover" }, h1);
    w.reject(id, { type: "finish" }, h1, "PROOF_MISSING");
    w.do(id, { type: "record_receipt", amount: 18000 }, h1);
    w.do(id, { type: "finish" }, h1);
    expect(w.get(id).status).toBe("check");
  });

  it("only the assigned helper can start, add proof and finish", () => {
    const w = new World();
    const id = w.post();
    w.pay(id);
    w.do(id, { type: "accept" }, h1);
    w.reject(id, { type: "start" }, h2, "FORBIDDEN");
    w.reject(id, { type: "start" }, c1, "FORBIDDEN");
    w.do(id, { type: "start" }, h1);
    w.reject(id, { type: "record_handover" }, h2, "FORBIDDEN");
    w.reject(id, { type: "record_receipt", amount: 100 }, h1, "INVALID_INPUT"); // no item budget
  });
});

describe("cancellation", () => {
  it("before payment: cancelled, no money moved", () => {
    const w = new World();
    const id = w.post();
    w.do(id, { type: "cancel" }, c1);
    expect(w.get(id).status).toBe("cancelled");
    expect(w.ledger).toEqual([]);
  });

  it("before match: free, full refund", () => {
    const w = new World();
    const id = w.post({ itemBudget: 38000, fee: 9000 });
    w.pay(id);
    w.do(id, { type: "cancel" }, c1);
    expect(w.get(id).status).toBe("cancelled");
    expect(w.bal(ext("c1"))).toBe(0);
  });

  it("after match, before start: ₮3,000 to the helper, rest refunded", () => {
    const w = new World();
    const id = w.post({ fee: 10000 });
    w.pay(id);
    w.do(id, { type: "accept" }, h1);
    w.do(id, { type: "cancel" }, c1);
    expect(w.get(id).status).toBe("cancelled");
    expect(w.bal(payable("h1"))).toBe(3000);
    expect(w.bal(ext("c1"))).toBe(-3000);
    expect(w.bal("platform")).toBe(0);
  });

  it("customer cannot cancel once the helper has started", () => {
    const w = new World();
    const id = w.post();
    w.pay(id);
    w.do(id, { type: "accept" }, h1);
    w.do(id, { type: "start" }, h1);
    w.reject(id, { type: "cancel" }, c1, "ILLEGAL_TRANSITION");
  });

  it("helper cancels: full refund to the customer and a penalty effect", () => {
    const w = new World();
    const id = w.post({ itemBudget: 5000 });
    w.pay(id);
    w.do(id, { type: "accept" }, h1);
    w.do(id, { type: "start" }, h1);
    const t = w.do(id, { type: "cancel" }, h1);
    expect(w.get(id).status).toBe("cancelled");
    expect(w.bal(ext("c1"))).toBe(0);
    expect(w.bal(payable("h1"))).toBe(0);
    expect(t.effects).toEqual([{ kind: "helper_penalty", helperId: "h1", dealId: id }]);
  });

  it("strangers cannot cancel", () => {
    const w = new World();
    const id = w.post();
    w.pay(id);
    w.reject(id, { type: "cancel" }, h2, "FORBIDDEN");
    w.reject(id, { type: "cancel" }, customer("c2"), "FORBIDDEN");
  });
});

describe("no-match expiry", () => {
  it("Now task with no helper after 30 min → expired with full refund", () => {
    const w = new World();
    const id = w.post({ itemBudget: 10000 });
    w.pay(id);
    expect((w.get(id) as ErrandDeal).matchBy).toBe(T0 + 30 * MINUTE_MS);
    w.reject(id, { type: "expire" }, system, "ILLEGAL_TRANSITION"); // too early
    w.now += 29 * MINUTE_MS;
    expect(w.tick()).toBe(0);
    w.now += MINUTE_MS;
    expect(w.tick()).toBe(1);
    expect(w.get(id).status).toBe("expired");
    expect(w.bal(ext("c1"))).toBe(0);
    expect(w.tick()).toBe(0);
  });

  it("a matched task never expires", () => {
    const w = new World();
    const id = w.post();
    w.pay(id);
    w.do(id, { type: "accept" }, h1);
    w.advance(48);
    expect(w.tick()).toBe(0);
    expect(w.get(id).status).toBe("matched");
  });

  it("only the system can expire", () => {
    const w = new World();
    const id = w.post();
    w.pay(id);
    w.advance(1);
    w.reject(id, { type: "expire" }, c1, "FORBIDDEN");
  });
});

describe("release", () => {
  it("auto-release fires exactly once, only after the window", () => {
    const w = new World();
    const id = toCheck(w);
    w.reject(id, { type: "auto_release" }, system, "ILLEGAL_TRANSITION");
    w.advance(23);
    expect(w.tick()).toBe(0);
    w.advance(1);
    expect(w.tick()).toBe(1);
    expect(w.get(id).status).toBe("released");
    expect(w.tick()).toBe(0);
    w.advance(100);
    expect(w.tick()).toBe(0);
    w.reject(id, { type: "auto_release" }, system, "ILLEGAL_TRANSITION");
    expect(w.ledger.filter((e) => e.kind === "release_fee")).toHaveLength(1);
    expect(w.codes(id).filter((c) => c === "released")).toHaveLength(1);
  });

  it("no double release: confirm twice, or confirm after auto-release", () => {
    const w = new World();
    const a = toCheck(w);
    w.do(a, { type: "confirm" }, c1);
    w.reject(a, { type: "confirm" }, c1, "ILLEGAL_TRANSITION");

    const b = toCheck(w);
    w.advance(24);
    w.tick();
    w.reject(b, { type: "confirm" }, c1, "ILLEGAL_TRANSITION");
    w.reject(b, { type: "resolve", outcome: "release" }, admin(), "ILLEGAL_TRANSITION");
    expect(w.ledger.filter((e) => e.kind === "release_fee")).toHaveLength(2);
  });

  it("applying a stale copy of the deal cannot double-release either", () => {
    const w = new World();
    const id = toCheck(w);
    const stale = w.get(id);
    w.do(id, { type: "confirm" }, c1);
    // The engine itself can't see the DB; a stale read would succeed, which is why callers
    // must persist with optimistic locking on `version`.
    const replay = apply(stale, { type: "confirm" }, { now: w.now, actor: c1 });
    expect(replay.deal.version).toBe(w.get(id).version);
  });

  it("only the customer can confirm or dispute", () => {
    const w = new World();
    const id = toCheck(w);
    w.reject(id, { type: "confirm" }, h1, "FORBIDDEN");
    w.reject(id, { type: "confirm" }, admin(), "FORBIDDEN");
    w.reject(id, { type: "dispute", reason: "x" }, h1, "FORBIDDEN");
  });
});

describe("disputes", () => {
  it("pauses release: the check window passing does nothing", () => {
    const w = new World();
    const id = toCheck(w);
    w.do(id, { type: "dispute", reason: "Wrong items or receipt", note: "Got skim milk" }, c1);
    w.advance(500);
    expect(w.tick()).toBe(0);
    expect(w.get(id).status).toBe("disputed");
    expect(w.get(id).heldAmount).toBe(48000);
    w.reject(id, { type: "confirm" }, c1, "ILLEGAL_TRANSITION");
  });

  it("Ops refund returns the full held amount to the customer", () => {
    const w = new World();
    const id = toCheck(w);
    w.do(id, { type: "dispute", reason: "Task not done" }, c1);
    w.reject(id, { type: "resolve", outcome: "refund" }, h1, "FORBIDDEN");
    w.do(id, { type: "resolve", outcome: "refund" }, admin());
    expect(w.get(id).status).toBe("refunded");
    expect(w.bal(ext("c1"))).toBe(0);
    expect(w.bal(payable("h1"))).toBe(0);
    expect(w.get(id).dispute).toMatchObject({ outcome: "refund", decidedBy: "ops" });
  });

  it("Ops release pays the normal split", () => {
    const w = new World();
    const id = toCheck(w, { receipt: 38000 });
    w.do(id, { type: "dispute", reason: "Done badly" }, c1);
    w.do(id, { type: "resolve", outcome: "release" }, admin());
    expect(w.get(id).status).toBe("released");
    expect(w.bal(payable("h1"))).toBe(8100 + 38000);
    expect(w.bal(ext("c1"))).toBe(-48000);
  });

  it("requires a reason", () => {
    const w = new World();
    const id = toCheck(w);
    w.reject(id, { type: "dispute", reason: "  " }, c1, "INVALID_INPUT");
  });
});

describe("purity", () => {
  it("never mutates the input deal and bumps version once per transition", () => {
    const w = new World();
    const id = w.post();
    const before = w.get(id);
    const snapshot = structuredClone(before);
    const t = apply(before, { type: "confirm_payment", providerRef: "r", amount: 11000 }, { now: T0, actor: provider });
    expect(before).toEqual(snapshot);
    expect(t.deal.version).toBe(before.version + 1);
  });
});
