import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, MINUTE_MS, apply, createErrand, ruleOf, type EngineConfig, type ErrandDeal } from "../index";
import { dueWave, pickWave } from "@/lib/dispatch/plan";

/** Rules from the database (docs/decisions.md 2026-11-18): tasks copy their timings when posted. */
const T0 = Date.UTC(2026, 10, 20, 4);
const customer = { kind: "user" as const, id: "c1", role: "customer" as const };
const helper = { kind: "user" as const, id: "h1", role: "helper" as const, helperApproved: true, categories: ["shop" as const] };

function post(cfg: EngineConfig): ErrandDeal {
  return createErrand(
    { id: "R1", title: "t", description: "d", category: "shop", mode: "now", address: "a", itemBudget: 0, fee: 6000, customerId: "c1" },
    { now: T0, actor: customer },
    cfg,
  ).deal;
}

describe("a task runs by the rules it was posted with", () => {
  const custom: EngineConfig = { ...DEFAULT_CONFIG, paymentWindowMinutes: 20, backOutGraceMinutes: 2, nowMatchWindowMinutes: 45, applicationMinutes: 30, autoPickMinutes: 5 };

  it("copies the timings onto the task", () => {
    expect(post(custom).details.rules).toEqual({ paymentWindowMinutes: 20, backOutGraceMinutes: 2, rematchWindowMinutes: 45, applicationMinutes: 30, autoPickMinutes: 5, arriveMinutes: 45, lateGraceMinutes: 15, settleHours: 24, absentGraceMinutes: 10, maxDelayMinutes: 30, keepFeeOnCancel: 1 });
  });

  it("uses them: payment window, free back-out window", () => {
    let d = post(custom);
    d = apply(d, { type: "accept" }, { now: T0 + MINUTE_MS, actor: helper }).deal as ErrandDeal;
    expect(d.payBy).toBe(T0 + MINUTE_MS + 20 * MINUTE_MS);
    // 3 minutes after being chosen is past this task's 2-minute grace → a penalty
    const late = apply(d, { type: "cancel" }, { now: T0 + 4 * MINUTE_MS, actor: helper });
    expect(late.effects).toEqual([{ kind: "helper_penalty", helperId: "h1", dealId: "R1" }]);
    expect(late.deal.matchBy).toBe(T0 + 4 * MINUTE_MS + 45 * MINUTE_MS);
  });

  it("older tasks (no saved rules) keep the built-in defaults", () => {
    const old = { ...post(custom), details: { ...post(custom).details, rules: undefined } };
    expect(ruleOf(old, "paymentWindowMinutes")).toBe(DEFAULT_CONFIG.paymentWindowMinutes);
    expect(ruleOf(old, "backOutGraceMinutes")).toBe(DEFAULT_CONFIG.backOutGraceMinutes);
  });
});

describe("helper notification waves from the settings", () => {
  const waves = [
    { radiusKm: 1, max: 2, seconds: 30 },
    { radiusKm: 1000, max: 50, seconds: 0 },
  ];
  const c = (helperId: string, distanceKm: number | null) => ({ helperId, distanceKm, ratingSum: 0, ratingCount: 0, completed: 0, offers30d: 0, won30d: 0 });

  it("paces and limits by the given waves", () => {
    expect(dueWave(-1, null, T0, waves)).toBe(0);
    expect(dueWave(0, T0, T0 + 10_000, waves)).toBeNull();
    expect(dueWave(0, T0, T0 + 30_000, waves)).toBe(1);
    expect(dueWave(1, T0, T0 + 999_000, waves)).toBeNull(); // the last wave is final
    const first = pickWave([c("a", 0.5), c("b", 0.8), c("c", 0.9), c("far", 5), c("nopos", null)], 0, new Set(), waves);
    expect(first).toHaveLength(2); // at most `max`, nearest first
    expect(first.map((x) => x.helperId)).not.toContain("far"); // outside 1 km
    expect(first.map((x) => x.helperId)).not.toContain("nopos"); // no position: only the last wave
    expect(pickWave([c("far", 5), c("nopos", null)], 1, new Set(), waves).map((x) => x.helperId).sort()).toEqual(["far", "nopos"]);
  });
});
