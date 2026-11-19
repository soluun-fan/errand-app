import { describe, expect, it } from "vitest";
import { titleFromBrief } from "@/lib/task-brief";

describe("a request message becomes a task title", () => {
  it("uses the first nonempty line and removes a list bullet", () => {
    expect(titleFromBrief("\n  • Сүү 2 литр\r\n• Талх 1 ширхэг", 40)).toBe("Сүү 2 литр");
  });

  it("normalizes spacing and keeps whole words within the title limit", () => {
    expect(titleFromBrief("  Please   bring milk and bread from the nearby shop", 40)).toBe("Please bring milk and bread from the");
  });

  it("fits long unbroken text without dropping half an emoji", () => {
    expect(titleFromBrief("a".repeat(39) + "🛒", 40)).toBe("a".repeat(39));
    expect(titleFromBrief("а".repeat(55), 40)).toBe("а".repeat(40));
  });

  it("handles an empty draft and preserves a nonempty symbol-only request", () => {
    expect(titleFromBrief(" \n  ", 40)).toBe("");
    expect(titleFromBrief("-", 40)).toBe("-");
    expect(titleFromBrief("• ", 40)).toBe("•");
  });
});
