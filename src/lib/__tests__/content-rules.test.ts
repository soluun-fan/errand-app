import { describe, expect, it } from "vitest";
import { QuickStartInput, parseKeywords, qsTitle, rankByUse, shownNow, ubMonth, type QuickStart } from "@/lib/content-rules";

const q = (over: Partial<QuickStart>): QuickStart => ({
  id: over.id ?? "x",
  kind: "popular",
  category: "shop",
  titleMn: "Хүнс авчрах",
  titleEn: "Groceries",
  months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  sort: 0,
  active: true,
  ...over,
});

describe("quick starts from the database (docs/decisions.md 2026-11-16 \"From the database\")", () => {
  it("uses Ulaanbaatar's month (UTC+8)", () => {
    expect(ubMonth(Date.UTC(2026, 9, 31, 17, 0))).toBe(11); // 31 Oct 17:00 UTC = 1 Nov 01:00 in UB
    expect(ubMonth(Date.UTC(2026, 9, 31, 15, 0))).toBe(10);
  });
  it("shows active ones of that kind in this month, in Ops' order", () => {
    const nov = Date.UTC(2026, 10, 16, 4);
    const list = [
      q({ id: "b", kind: "seasonal", months: [11, 12, 1], sort: 20 }),
      q({ id: "a", kind: "seasonal", months: [11], sort: 10 }),
      q({ id: "summer", kind: "seasonal", months: [6, 7] }),
      q({ id: "off", kind: "seasonal", active: false }),
      q({ id: "pop", kind: "popular" }),
    ];
    expect(shownNow(list, "seasonal", nov).map((x) => x.id)).toEqual(["a", "b"]);
  });
  it("puts what people actually post first; Ops' order breaks ties", () => {
    const list = [q({ id: "sofa", titleMn: "Буйдан зөөх", sort: 1 }), q({ id: "tap", titleMn: "Цорго засах", titleEn: "Fix a tap", sort: 2 }), q({ id: "x", titleMn: "Өөр", sort: 3 })];
    const uses = new Map([["цорго засах", 3], ["fix a tap", 1], ["буйдан зөөх", 2]]);
    expect(rankByUse(list, uses).map((x) => x.id)).toEqual(["tap", "sofa", "x"]);
    expect(rankByUse(list, new Map()).map((x) => x.id)).toEqual(["sofa", "tap", "x"]);
  });
  it("picks the title in the viewer's language", () => {
    expect(qsTitle(q({}), "en")).toBe("Groceries");
    expect(qsTitle(q({}), "mn")).toBe("Хүнс авчрах");
  });
  it("validates Ops' input: title length, months 1–12 (deduplicated), known kind of task", () => {
    const ok = QuickStartInput.parse({ id: null, kind: "seasonal", category: "carry", titleMn: " Байр нүүх ", titleEn: "Move", months: [5, 4, 5], sort: 1, active: true });
    expect(ok).toMatchObject({ titleMn: "Байр нүүх", months: [4, 5] });
    const bad = { id: null, kind: "seasonal", category: "carry", titleMn: "Байр нүүх", titleEn: "Move", sort: 1, active: true };
    expect(QuickStartInput.safeParse({ ...bad, months: [] }).success).toBe(false);
    expect(QuickStartInput.safeParse({ ...bad, months: [13] }).success).toBe(false);
    expect(QuickStartInput.safeParse({ ...bad, months: [1], category: "boats" }).success).toBe(false);
    expect(QuickStartInput.safeParse({ ...bad, months: [1], titleMn: "x".repeat(41) }).success).toBe(false);
  });
  it("reads search words one per line or comma-separated, lower-cased and unique", () => {
    expect(parseKeywords("Зөө\nбуйдан,  угаалгын   машин\n\nзөө")).toEqual(["зөө", "буйдан", "угаалгын машин"]);
    expect(parseKeywords("а")).toBeNull(); // too short to mean anything
  });
});
