import { describe, expect, it } from "vitest";
import { BIO_MAX, cleanBio, maskName, median, publicNote, tagCounts } from "@/lib/profile-rules";

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

describe("helper listing rules", () => {
  it("tidies the intro, caps its length and masks phone numbers and links", () => {
    expect(cleanBio("  ")).toEqual({ bio: null, masked: false });
    expect(cleanBio("Сайн  байна уу\r\n\n\n\nМашинтай")).toEqual({ bio: "Сайн байна уу\n\nМашинтай", masked: false });
    const r = cleanBio("Залгаарай 99112233 эсвэл fb: myname");
    expect(r.masked).toBe(true);
    expect(r.bio).not.toMatch(/99112233|myname/);
    expect(cleanBio("x".repeat(BIO_MAX + 50)).bio).toHaveLength(BIO_MAX);
  });
  it("median: the middle job price (lower middle when even), none under the minimum count", () => {
    expect(median([9000, 5000, 12000], 3)).toBe(9000);
    expect(median([5000, 6000, 8000, 20000])).toBe(6000);
    expect(median([5000, 6000], 3)).toBeNull();
  });
});
