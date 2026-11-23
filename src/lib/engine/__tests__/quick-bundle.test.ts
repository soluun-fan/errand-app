import { expect, it } from "vitest";
import { DEFAULT_CONFIG, amountDue, apply, createErrand, type ErrandDeal } from "../index";

/** 2026-11-22 quick bundle: first task free, cancellation reasons. */
const now = Date.UTC(2026, 10, 22, 3);
const customer = { kind: "user", id: "c1", role: "customer" } as const;
const post = (firstTask: boolean, cfg = DEFAULT_CONFIG) =>
  createErrand({ id: crypto.randomUUID(), title: "Buy bread", description: "x", category: "shop", mode: "now", address: "Test", customerId: "c1", fee: 10_000, itemBudget: 0, firstTask }, { now, actor: customer }, cfg).deal;

it("a customer's first task has no service fee (when Ops allows it); later ones do", () => {
  const first = post(true);
  expect(first.serviceFee).toBe(0);
  expect(first.details.freeFirst).toBe(true);
  expect(amountDue(first)).toBe(10_000);
  expect(post(false).serviceFee).toBe(1000);
  expect(post(true, { ...DEFAULT_CONFIG, firstTaskFree: false }).serviceFee).toBe(1000);
});

it("the customer may say why they cancel; it's kept on the timeline", () => {
  const d = post(false) as ErrandDeal;
  const t = apply(d, { type: "cancel", reason: "foundOther" }, { now, actor: customer });
  expect(t.events.find((e) => e.code === "cancelled")?.data).toEqual({ by: "customer", reason: "foundOther" });
  const plain = apply(d, { type: "cancel" }, { now, actor: customer });
  expect(plain.events.find((e) => e.code === "cancelled")?.data).toEqual({ by: "customer" });
});
