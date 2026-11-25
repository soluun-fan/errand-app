import { expect, it } from "vitest";
import { kindFromLabel, type ErrandDeal } from "../index";
import { TEST_CONFIG, World } from "./helpers";

it("uses the configured category review window and preserves existing task terms", () => {
  const cfg = { ...TEST_CONFIG, kindCheckHours: { plumbing: 48 }, errandCheckHours: 36 };
  const w = new World(cfg);
  const original = w.post({ category: "plumbing" });
  expect((w.get(original) as ErrandDeal).checkHours).toBe(48);
  cfg.kindCheckHours.plumbing = 96;
  const newer = w.post({ category: "plumbing" });
  expect((w.get(newer) as ErrandDeal).checkHours).toBe(96);
  expect((w.get(original) as ErrandDeal).checkHours).toBe(48);
  expect((w.get(w.post({ category: "electrical" })) as ErrandDeal).checkHours).toBe(36);
});

it("uses the configured default duration for a day job's starting price", () => {
  const cfg = { ...TEST_CONFIG, kindMinHourly: { dayjob: 5000 }, kindMinutes: { dayjob: 120 } };
  expect(kindFromLabel("dayjob", cfg)).toEqual({ amount: 10000, hourly: false });
});
