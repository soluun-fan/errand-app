import { describe, expect, it } from "vitest";
import { maskName, publicNote, tagCounts } from "@/lib/profile-rules";

describe("public helper profile rules", () => {
  it("masks reviewer names to the first letter", () => {
    expect(maskName("Солонго")).toBe("С*****");
    expect(maskName("Бо")).toBe("Б**");
    expect(maskName("  ")).toBe("***");
    expect(maskName(null)).toBe("***");
  });

  it("removes contact details from public review notes", () => {
    expect(publicNote("Маш сайн! 9911 2233 руу залгаарай")).not.toMatch(/9911/);
    expect(publicNote("  ")).toBeNull();
    expect(publicNote("x".repeat(500))?.length).toBe(300);
  });

  it("counts tags, most frequent first, only allowed ones", () => {
    const allowed = ["onTime", "careful", "friendly"];
    expect(tagCounts([["careful", "onTime"], ["onTime"], ["onTime", "hacked"]], allowed)).toEqual([
      { tag: "onTime", n: 3 },
      { tag: "careful", n: 1 },
    ]);
  });
});
