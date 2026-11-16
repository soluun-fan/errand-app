import { describe, expect, it } from "vitest";
import { CallLogInput, DetailsJson, PinJson, ProofKindInput, PushSubscriptionInput, UploadPath, Uuid, isValid, parseOr } from "@/lib/input";

describe("input shapes (server actions are public endpoints)", () => {
  it("pins: JSON text → point; empty = none; junk rejected", () => {
    expect(parseOr(PinJson, '{"lat":47.9,"lng":106.9}')).toEqual({ lat: 47.9, lng: 106.9 });
    expect(isValid(PinJson, "")).toBe(true);
    expect(parseOr(PinJson, "")).toBeNull();
    for (const bad of ["{", '{"lat":"47","lng":106}', '{"lat":95,"lng":106}', '{"lat":1e999,"lng":1}']) expect(isValid(PinJson, bad)).toBe(false);
  });

  it("task details: wrong types are refused (instead of crashing later), engine-only fields are dropped", () => {
    const ok = parseOr(DetailsJson, JSON.stringify({ km: 3, people: 2, entrance: "2", quotedFee: 1, counterMax: 999999 }));
    expect(ok).toEqual({ km: 3, people: 2, entrance: "2" });
    expect(parseOr(DetailsJson, "")).toEqual({});
    expect(isValid(DetailsJson, JSON.stringify({ entrance: 5 }))).toBe(false);
    expect(isValid(DetailsJson, JSON.stringify({ people: 3 }))).toBe(false);
    expect(isValid(DetailsJson, JSON.stringify({ lift: "maybe" }))).toBe(false);
    expect(isValid(DetailsJson, "not json")).toBe(false);
  });

  it("proof kind is one of two words — it becomes part of a storage path", () => {
    expect(parseOr(ProofKindInput, "receipt")).toBe("receipt");
    expect(parseOr(ProofKindInput, "../other-task/receipt")).toBeNull();
  });

  it("ids, upload paths, push subscriptions, call logs", () => {
    expect(isValid(Uuid, crypto.randomUUID())).toBe(true);
    expect(isValid(Uuid, "1; drop table deals")).toBe(false);
    expect(isValid(UploadPath.nullable(), null)).toBe(true);
    expect(isValid(UploadPath, 42)).toBe(false);
    expect(isValid(PushSubscriptionInput, { endpoint: "https://push.example/abc", keys: { p256dh: "k", auth: "a" } })).toBe(true);
    expect(isValid(PushSubscriptionInput, { endpoint: "http://push.example/abc", keys: { p256dh: "k", auth: "a" } })).toBe(false);
    expect(isValid(CallLogInput, { kind: "ended", video: false, seconds: 61 })).toBe(true);
    expect(isValid(CallLogInput, { kind: "ended", video: false })).toBe(false);
    expect(isValid(CallLogInput, { kind: "hacked", video: true })).toBe(false);
  });
});
