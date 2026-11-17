import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, ROAD_FACTOR, createErrand, quoteFee, roadKm, straightKm, type NewErrandInput } from "../index";
import { T0, customer } from "./helpers";

// Sükhbaatar Square, and a point ~2 km north of it (0.018° of latitude ≈ 2.0 km)
const SQ = { lat: 47.9186, lng: 106.9177 };
const NORTH_2KM = { lat: 47.9366, lng: 106.9177 };

describe("distance from two pins (docs/decisions.md 2026-11-16 \"Maps connected\")", () => {
  it("is the straight line times the road factor, to 0.1 km", () => {
    expect(straightKm(SQ, NORTH_2KM)).toBeCloseTo(2.0, 1);
    expect(roadKm(SQ, NORTH_2KM)).toBe(Math.round(straightKm(SQ, NORTH_2KM) * ROAD_FACTOR * 10) / 10);
    expect(roadKm(SQ, NORTH_2KM)).toBe(2.6);
    expect(roadKm(SQ, SQ)).toBe(0);
  });
});

describe("pickup pin at posting", () => {
  const post = (input: Partial<NewErrandInput>) =>
    createErrand(
      {
        id: "E1",
        title: "Groceries",
        description: "Milk and bread",
        category: "shop",
        mode: "now",
        address: "8th khoroo",
        itemBudget: 0,
        fee: 0,
        customerId: "c1",
        ...input,
      },
      { now: T0, actor: customer("c1") },
      DEFAULT_CONFIG,
    ).deal;
  const priceFor = (km: number) => quoteFee("shop", { ...post({ fee: 5000 }).details, km }, DEFAULT_CONFIG, T0).total;

  it("measures the distance itself — the client's number is ignored when both pins are set", () => {
    const fee = priceFor(2.6);
    const d = post({ fee, location: NORTH_2KM, pickupLocation: SQ, details: { km: 0.1 } });
    expect(d.details.km).toBe(2.6);
    expect(d.pickupLocation).toEqual(SQ);
    expect(d.details.quotedFee).toBe(fee);
  });

  it("records the real distance for helpers, whatever the client claims", () => {
    // the customer names the price, but helpers see the true trip length from the pins
    const far = { lat: 47.99, lng: 106.9177 }; // ~8 km
    // …and the true length sets the minimum: a client claiming 0.1 km can't post a 9 km trip at the floor
    expect(() => post({ fee: 5000, location: far, pickupLocation: SQ, details: { km: 0.1 } })).toThrow(/Minimum fee/);
    const d = post({ fee: 30_000, location: far, pickupLocation: SQ, details: { km: 0.1 } });
    expect(d.details.km).toBeGreaterThan(9);
    expect(d.details.minFee).toBeGreaterThan(5000);
  });

  it("keeps the customer's rough distance when there is no pickup pin", () => {
    const d = post({ fee: priceFor(3), location: SQ, details: { km: 3 } });
    expect(d.details.km).toBe(3);
    expect(d.pickupLocation).toBeNull();
  });

  it("ignores a pickup pin on one-place tasks (queue, repair…)", () => {
    const d = createErrand(
      { id: "Q1", title: "Queue", description: "At the tax office", category: "queue", mode: "now", address: "Tax office", itemBudget: 0, fee: 5000, customerId: "c1", location: SQ, pickupLocation: NORTH_2KM },
      { now: T0, actor: customer("c1") },
      DEFAULT_CONFIG,
    ).deal;
    expect(d.pickupLocation).toBeNull();
    expect(d.details.km).toBe(0);
  });

  it("rejects pins outside Mongolia and trips over 100 km", () => {
    expect(() => post({ fee: 5000, location: SQ, pickupLocation: { lat: 106.9, lng: 47.9 } })).toThrow(/inside Mongolia/);
    const darkhan = { lat: 49.4867, lng: 105.9228 }; // ~190 km
    expect(() => post({ fee: 5000, location: SQ, pickupLocation: darkhan })).toThrow(/Distance must be between/);
  });
});
