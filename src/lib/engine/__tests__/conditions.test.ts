import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, DEFAULT_DETAILS, apply, createErrand, missingConditions, type ErrandDeal, type HelperBadges, type TaskConditions } from "../index";

/** Task conditions (docs/decisions.md 2026-11-18): only helpers who meet them can apply. */
const T0 = Date.UTC(2026, 10, 20, 4);
const none: HelperBadges = { driver: false, car: false, checked: false, onTimeOk: true, languages: [] };
const post = (require: unknown) =>
  createErrand(
    { id: "C1", title: "t", description: "d", category: "deliver", mode: "now", address: "a", itemBudget: 0, fee: 8000, customerId: "c1", details: { ...DEFAULT_DETAILS, require } as never },
    { now: T0, actor: { kind: "user", id: "c1", role: "customer" } },
    DEFAULT_CONFIG,
  ).deal as ErrandDeal;
const helper = (badges?: HelperBadges) => ({ kind: "user" as const, id: "h1", role: "helper" as const, helperApproved: true, categories: ["deliver" as const], badges });

describe("conditions on a task", () => {
  it("keeps only known conditions and languages", () => {
    expect(post({ driver: true, car: false, hack: true, language: "xx" }).details.require).toEqual({ driver: true });
    expect(post({ language: "en", handoverCode: true }).details.require).toEqual({ handoverCode: true, language: "en" });
    expect(post({}).details.require).toBeUndefined();
  });

  it("lists what a helper is missing", () => {
    const req: TaskConditions = { driver: true, car: true, checked: true, onTime: true, language: "ru", call: true, handoverCode: true };
    expect(missingConditions(req, none)).toEqual(["driver", "car", "checked", "language"]); // a new helper passes "on time"; call / code aren't badges
    expect(missingConditions(req, { ...none, onTimeOk: false })).toContain("onTime");
    expect(missingConditions(req, { driver: true, car: true, checked: true, onTimeOk: true, languages: ["ru"] })).toEqual([]);
    expect(missingConditions(undefined, undefined)).toEqual([]);
  });

  it("a helper without the badges can't apply; with them they can", () => {
    const d = post({ driver: true, language: "en" });
    expect(() => apply(d, { type: "apply", note: "" }, { now: T0 + 1, actor: helper(none) })).toThrow(/needs: driver, language/);
    expect(() => apply(d, { type: "accept" }, { now: T0 + 1, actor: helper(undefined) })).toThrow(/needs/);
    const ok = apply(d, { type: "apply", note: "" }, { now: T0 + 1, actor: helper({ ...none, driver: true, languages: ["en"] }) });
    expect(ok.deal.status).toBe("open");
  });

  it("tasks without conditions are open to every helper", () => {
    expect(apply(post(undefined), { type: "apply", note: "" }, { now: T0 + 1, actor: helper(undefined) }).deal.status).toBe("open");
  });
});
