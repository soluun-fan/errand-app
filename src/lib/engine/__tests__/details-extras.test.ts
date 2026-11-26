import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, createErrand, type ErrandDetails, type NewErrandInput } from "../index";
import { T0, customer } from "./helpers";

// Parking (carry jobs in UB apartment yards) and "can be done without meeting" (2026-11-26)
const post = (details: Partial<ErrandDetails>, input: Partial<NewErrandInput> = {}) =>
  createErrand(
    { id: "D1", title: "Carry a sofa", description: "x", category: "carry", mode: "now", address: "Home", itemBudget: 0, fee: 20000, customerId: "c1", details, ...input },
    { now: T0, actor: customer("c1") },
    DEFAULT_CONFIG,
  ).deal;

describe("task details: parking and contactless", () => {
  it("keeps them as given", () => {
    const d = post({ parking: "no", contactless: true });
    expect(d.details.parking).toBe("no");
    expect(d.details.contactless).toBe(true);
  });

  it("defaults safely when absent (older clients and tasks)", () => {
    const d = post({});
    expect(d.details.parking).toBeNull();
    expect(d.details.contactless).toBe(false);
  });

  it("refuses a parking value it doesn't know", () => {
    expect(() => post({ parking: "maybe" as never })).toThrow("Bad parking value");
  });
});
