import { describe, expect, it } from "vitest";
import { guessCategory } from "@/lib/category-guess";

describe("guessCategory (search text → kind of task)", () => {
  it("recognises common Mongolian and English phrasing", () => {
    expect(guessCategory("Буйдан зөөх")).toBe("carry");
    expect(guessCategory("Хөргөгчийг 5 давхарт өргөх")).toBe("carry");
    expect(guessCategory("Номин супермаркетаас сүү авчрах")).toBe("shop");
    expect(guessCategory("Паспортын албанд дараалалд зогсох")).toBe("queue");
    expect(guessCategory("Дусалж буй цорго засах")).toBe("repair");
    expect(guessCategory("Бичиг баримт хүргэх")).toBe("deliver");
    expect(guessCategory("assemble a wardrobe")).toBe("repair");
  });
  it("says nothing when unsure", () => {
    expect(guessCategory("")).toBeNull();
    expect(guessCategory("тусламж хэрэгтэй")).toBeNull();
  });
});
