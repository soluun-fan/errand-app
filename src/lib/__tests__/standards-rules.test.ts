import { expect, it } from "vitest";
import { checkStart, recordLevel, startPoint } from "@/lib/standards-rules";

const pin = { lat: 47.9184, lng: 106.9177 }; // Sükhbaatar Square
const near = { lat: 47.9194, lng: 106.9177 }; // ~110 m north
const far = { lat: 47.9284, lng: 106.9177 }; // ~1.1 km north
const now = Date.UTC(2026, 10, 22, 4);

it("starts at the pickup pin, else the task pin; two-place tasks without a pickup have no check", () => {
  expect(startPoint({ category: "shop", pickupLocation: near, pickupAddress: "Номин", location: pin })).toEqual(near);
  expect(startPoint({ category: "shop", pickupLocation: null, pickupAddress: null, location: pin })).toBeNull();
  expect(startPoint({ category: "queue", pickupLocation: null, pickupAddress: null, location: pin })).toEqual(pin);
  // the customer chose two places on a one-place kind (2026-11-26): no fixed start without a pin
  expect(startPoint({ category: "repair", pickupLocation: null, pickupAddress: "Их дэлгүүр", location: pin })).toBeNull();
  expect(startPoint({ category: "repair", pickupLocation: near, pickupAddress: "Их дэлгүүр", location: pin })).toEqual(near);
});

it("start needs a fresh position within the radius", () => {
  expect(checkStart(null, null, now, 200, 120)).toEqual({ ok: true });
  expect(checkStart(pin, null, now, 200, 120)).toEqual({ ok: false, reason: "no_position" });
  expect(checkStart(pin, { ...near, at: now - 121_000 }, now, 200, 120)).toEqual({ ok: false, reason: "stale" });
  expect(checkStart(pin, { ...near, at: now + 120_000 }, now, 200, 120)).toEqual({ ok: false, reason: "stale" });
  expect(checkStart(pin, { ...near, at: now - 10_000 }, now, 200, 120)).toEqual({ ok: true });
  const r = checkStart(pin, { ...far, at: now }, now, 200, 120);
  expect(r.ok).toBe(false);
  expect(r.ok === false && r.reason === "far" && r.meters).toBeGreaterThan(1000);
});

it("the ladder follows the Ops thresholds", () => {
  const r = { marksRankLower: 2, marksPause: 3, marksReview: 4 };
  expect([0, 1, 2, 3, 4, 9].map((n) => recordLevel(n, r))).toEqual(["clear", "warning", "ranked_lower", "paused", "review", "review"]);
});
