import { describe, expect, it } from "vitest";
import { guessCategory, type Keywords } from "@/lib/category-guess";

// A few of the words seeded in supabase/migrations/20261116040000_listings_direct_requests.sql
// (the live list is in the `category_keywords` table, edited by Ops).
const WORDS: Keywords = {
  carry: ["зөө", "буйдан", "хөргөгч", "өргө", "ор"],
  queue: ["дараалал", "зогсо", "паспорт"],
  repair: ["засах", "цорго", "assemble"],
  deliver: ["хүргэ", "бичиг баримт"],
  shop: ["хүнс", "сүү", "супермаркет", "номин", "авчр", "эм"],
};
const guess = (s: string) => guessCategory(s, WORDS);

describe("guessCategory (search text → kind of task)", () => {
  it("recognises common Mongolian and English phrasing", () => {
    expect(guess("Буйдан зөөх")).toBe("carry");
    expect(guess("Хөргөгчийг 5 давхарт өргөх")).toBe("carry");
    expect(guess("Номин супермаркетаас сүү авчрах")).toBe("shop");
    expect(guess("Паспортын албанд дараалалд зогсох")).toBe("queue");
    expect(guess("Дусалж буй цорго засах")).toBe("repair");
    expect(guess("Бичиг баримт хүргэх")).toBe("deliver");
    expect(guess("assemble a wardrobe")).toBe("repair");
  });
  it("matches word starts; 1–2 letter words only as whole words; phrases as phrases", () => {
    expect(guess("эм авах")).toBe("shop");
    expect(guess("эмээд туслах")).toBeNull(); // "эм" is not the start of every word
    expect(guess("орой ирэх")).toBeNull(); // nor is "ор"
    expect(guess("баримт, бичиг")).toBeNull(); // the phrase needs its words in order
  });
  it("says nothing when unsure or when there are no words", () => {
    expect(guess("")).toBeNull();
    expect(guess("тусламж хэрэгтэй")).toBeNull();
    expect(guessCategory("Буйдан зөөх", {})).toBeNull();
  });
});
