import { describe, expect, it } from "vitest";
import { autoPickAt, type CategoryId, type ErrandDeal } from "../index";
import { World, admin, customer, helper, system } from "./helpers";

const worker = (category: CategoryId = "plumbing", orgId: string | null = "org1") => helper("h1", { qualified: [{ category, orgId }] });
const offer = (w: World, id: string, h = worker()) => w.do(id, { type: "apply", note: "Available" }, h);
const choose = (w: World, id: string) => w.do(id, { type: "choose", helperId: "h1" }, customer());
const finish = (w: World, id: string, h = worker()) => {
  w.do(id, { type: "start" }, h);
  w.do(id, { type: "record_handover" }, h);
  w.do(id, { type: "finish" }, h);
};

describe("specialized work", () => {
  it.each(["plumbing", "electrical", "cleaning", "childcare", "eldercare"] as const)("self-selected %s does not qualify a helper", (category) => {
    const w = new World();
    const id = w.post({ category });
    w.reject(id, { type: "apply", note: "" }, helper(), "FORBIDDEN");
    offer(w, id, worker(category));
    expect((w.get(id) as ErrandDeal).offers[0].orgId).toBe("org1");
  });

  it.each(["confirmed", "auto", "ops"] as const)("%s release pays the company its fee and materials, with unused budget refunded", (how) => {
    const w = new World();
    const id = w.post({ category: "plumbing", itemBudget: 20_000 });
    offer(w, id); choose(w, id); w.pay(id);
    w.do(id, { type: "start" }, worker());
    w.do(id, { type: "record_receipt", amount: 12_000 }, worker());
    w.do(id, { type: "record_handover" }, worker());
    w.do(id, { type: "finish" }, worker());
    expect((w.get(id) as ErrandDeal).checkHours).toBe(72);
    if (how === "confirmed") w.do(id, { type: "confirm" }, customer());
    if (how === "auto") { w.advance(73); w.tick(); }
    if (how === "ops") {
      w.do(id, { type: "dispute", reason: "quality", note: "Still leaking" }, customer());
      w.do(id, { type: "resolve", outcome: "release" }, admin());
    }
    expect(w.get(id).status).toBe("released");
    expect(w.bal("payable:org1")).toBe(21_000);
    expect(w.bal("payable:h1")).toBe(0);
    expect(w.ledger.find((e) => e.kind === "budget_refund")?.amount).toBe(8_000);
    w.check();
  });

  it("pays the company cancellation fees and clears the payee when an unpaid match lapses", () => {
    const w = new World();
    const id = w.post({ category: "cleaning" });
    offer(w, id, worker("cleaning")); choose(w, id);
    w.advance(11 / 60); w.tick();
    expect((w.get(id) as ErrandDeal).payeeOrgId).toBeNull();
    choose(w, id); w.pay(id);
    w.do(id, { type: "cancel" }, customer());
    expect(w.bal("payable:org1")).toBe(w.cfg.cancelFee);
    expect(w.bal("payable:h1")).toBe(0);
  });

  it("independent certified helpers receive their own payment", () => {
    const w = new World();
    const h = worker("electrical", null);
    const id = w.post({ category: "electrical" });
    offer(w, id, h); choose(w, id); w.pay(id); finish(w, id, h);
    w.do(id, { type: "confirm" }, customer());
    expect(w.bal("payable:h1")).toBe(9_000);
    expect((w.get(id) as ErrandDeal).payeeOrgId).toBeNull();
  });

  it("counter acceptance preserves the offer's company and rejects a revoked route", () => {
    const w = new World();
    const id = w.post({ category: "plumbing" });
    offer(w, id); w.do(id, { type: "counter", helperId: "h1", price: 12_000 }, customer());
    w.reject(id, { type: "accept_counter" }, worker("plumbing", "org2"), "FORBIDDEN");
    const both = helper("h1", { qualified: [{ category: "plumbing", orgId: "org2" }, { category: "plumbing", orgId: "org1" }] });
    w.do(id, { type: "accept_counter" }, both);
    expect((w.get(id) as ErrandDeal).payeeOrgId).toBe("org1");
  });

  it("an adult accompaniment booking stays open for multiple applicants until the poster chooses", () => {
    const w = new World();
    const id = w.post({ category: "escort", details: { autoPick: true } });
    w.reject(id, { type: "accept" }, helper(), "ILLEGAL_TRANSITION");
    offer(w, id, helper("h1"));
    offer(w, id, helper("h2"));
    w.do(id, { type: "counter", helperId: "h1", price: 12_000 }, customer());
    w.do(id, { type: "accept_counter" }, helper("h1"));
    expect(w.get(id)).toMatchObject({ status: "open", helperId: null, details: { autoPick: false } });
    w.reject(id, { type: "choose", helperId: "h1" }, system, "ILLEGAL_TRANSITION");
    w.do(id, { type: "choose", helperId: "h2" }, customer());
    expect(w.get(id)).toMatchObject({ status: "awaiting_payment", helperId: "h2" });
  });

  it.each(["childcare", "eldercare"] as const)("%s always requires the customer's final selection, even after bargaining", (category) => {
    const w = new World();
    const id = w.post({ category, details: { autoPick: true } });
    const h = worker(category);
    expect((w.get(id) as ErrandDeal).details.autoPick).toBe(false);
    w.reject(id, { type: "accept" }, h, "ILLEGAL_TRANSITION");
    w.reject(id, { type: "apply", note: "" }, helper("h9"), "FORBIDDEN"); // no care clearance, no agency
    offer(w, id, h);
    const tampered = { ...w.get(id), details: { ...(w.get(id) as ErrandDeal).details, autoPick: true } } as ErrandDeal;
    expect(autoPickAt(tampered, w.now)).toBeNull();
    w.reject(id, { type: "choose", helperId: "h1" }, system, "ILLEGAL_TRANSITION");
    w.do(id, { type: "counter", helperId: "h1", price: 15_000 }, customer());
    w.do(id, { type: "accept_counter" }, h);
    expect(w.get(id).status).toBe("open");
    expect((w.get(id) as ErrandDeal).offers[0]).toMatchObject({ proposedBy: "helper", price: 15_000, orgId: "org1" });
    choose(w, id);
    expect(w.get(id).status).toBe("awaiting_payment");
  });
});
