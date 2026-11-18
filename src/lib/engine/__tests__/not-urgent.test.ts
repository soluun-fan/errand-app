import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, MINUTE_MS, apply, createErrand, liveOffers, runDue, type ErrandDeal } from "../index";

/** Not-urgent posts (owner, 2026-11-18: "keep a post for 24 hours, it may be not very urgent job"). */
const T0 = Date.UTC(2026, 10, 20, 4);
const helper = (id: string) => ({ kind: "user" as const, id, role: "helper" as const, helperApproved: true, categories: ["shop" as const] });

describe("a not-urgent post", () => {
  const post = () =>
    createErrand(
      { id: "N1", title: "Return library books", description: "Any time today or tomorrow", category: "shop", mode: "schedule", address: "a", itemBudget: 0, fee: 6000, customerId: "c1" },
      { now: T0, actor: { kind: "user", id: "c1", role: "customer" } },
      DEFAULT_CONFIG,
    ).deal as ErrandDeal;

  it("stays open for the search window (24 h) with no set time", () => {
    const d = post();
    expect(d.scheduledAt).toBeNull();
    expect(d.matchBy).toBe(T0 + DEFAULT_CONFIG.scheduleMatchWindowMinutes * MINUTE_MS);
    expect(DEFAULT_CONFIG.scheduleMatchWindowMinutes).toBe(24 * 60);
  });

  it("offers don't lapse while it waits; it closes only after the window, charging nothing", () => {
    let d = post();
    d = apply(d, { type: "apply", note: "" }, { now: T0 + MINUTE_MS, actor: helper("h1") }).deal as ErrandDeal;
    expect(liveOffers(d, T0 + 20 * 60 * MINUTE_MS)).toHaveLength(1); // 20 h later the offer still counts
    expect(runDue(d, T0 + 23 * 60 * MINUTE_MS)).toBeNull(); // nothing due before 24 h
    const t = runDue(d, T0 + 24 * 60 * MINUTE_MS + 1);
    expect(t?.deal.status).toBe("expired");
    expect(t?.ledger).toEqual([]);
  });
});
