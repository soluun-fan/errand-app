import { cleanConditions } from "../conditions";
import { DetailsJson } from "@/lib/input";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, DEFAULT_DETAILS, apply, createErrand, missingConditions, type ErrandDeal, type HelperBadges, type TaskConditions } from "../index";

/** Task conditions (docs/decisions.md 2026-11-18): only helpers who meet them can apply. */
const T0 = Date.UTC(2026, 10, 20, 4);
const none: HelperBadges = { driver: false, car: false, checked: false, onTimeOk: true, languages: [] };
const post = (require: unknown, variety?: string) =>
  createErrand(
    { id: "C1", title: "t", description: "d", category: "deliver", mode: "now", address: "a", itemBudget: 0, fee: 8000, customerId: "c1", details: { ...DEFAULT_DETAILS, require, variety } as never },
    { now: T0, actor: { kind: "user", id: "c1", role: "customer" } },
    DEFAULT_CONFIG,
  ).deal as ErrandDeal;
const helper = (badges?: HelperBadges) => ({ kind: "user" as const, id: "h1", role: "helper" as const, helperApproved: true, categories: ["deliver" as const], badges });

describe("conditions on a task", () => {
  it("keeps only known conditions and languages", () => {
    expect(post({ driver: true, car: false, hack: true, language: "xx" }).details.require).toEqual({ driver: true });
    expect(post({ language: "en", handoverCode: true }).details.require).toEqual({ handoverCode: true, language: "en" });
    expect(DetailsJson.parse(JSON.stringify({ require: { checked: true } })).require).toEqual({});
    expect(cleanConditions({ checked: true })).toEqual({ checked: true });
    expect(post({}).details.require).toBeUndefined();
  });

  it("carries experience and custom labels from the posting form without granting or requiring a badge", () => {
    const require = { driver: true, elderCareExperience: true, custom: ["  Has   references ", "has references"] };
    const submitted = DetailsJson.parse(JSON.stringify({ require }));
    const stored = post(submitted.require).details.require;
    expect(stored).toEqual({ driver: true, elderCareExperience: true, custom: ["Has references"] });
    expect(missingConditions(stored, none)).toEqual(["driver"]);
    expect(cleanConditions(stored, { includeCustom: false })).toEqual({ driver: true, elderCareExperience: true });
  });

  it("bounds customer-written labels and drops malformed values", () => {
    expect(cleanConditions({ custom: [null, " ", "a".repeat(49), "one", "two", "three", "four", "five", "six"] })?.custom)
      .toEqual(["one", "two", "three", "four", "five"]);
    expect(DetailsJson.safeParse(JSON.stringify({ require: { custom: ["a".repeat(49)] } })).success).toBe(false);
  });

  it("keeps a variety for its own category and carries the agreed instructions through posting", () => {
    const form = DetailsJson.parse(JSON.stringify({ variety: "documents", require: { updates: true, handoverCode: true } }));
    const task = post(form.require, form.variety);
    expect(task.details.variety).toBe("documents");
    expect(task.details.require).toEqual({ updates: true, handoverCode: true });
    expect(missingConditions(task.details.require, none)).toEqual([]);
    expect(post({}, "mealPrep").details.variety).toBeUndefined();
    expect(post({}).details.variety).toBeUndefined();
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
