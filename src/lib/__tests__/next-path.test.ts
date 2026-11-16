import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/next-path";

describe("safeNext (where to go after login)", () => {
  it("keeps our own paths", () => {
    expect(safeNext("/post?cat=shop&title=Сүү")).toBe("/post?cat=shop&title=Сүү");
    expect(safeNext("/tasks/abc")).toBe("/tasks/abc");
  });
  it("never sends people to another site or back to login", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "evil", "", null, 5, "/login?next=/x", "/x\nSet-Cookie: a"]) {
      expect(safeNext(bad)).toBe("/");
    }
  });
});
