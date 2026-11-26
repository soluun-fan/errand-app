import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Design lint (docs/ui.md "Type scale"): every size, radius and colour in a class comes from the
 * tokens in src/app/globals.css, so screens can't drift apart one hand-picked value at a time.
 */
const ROOT = join(process.cwd(), "src");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : files(path);
    return /\.(tsx|ts)$/.test(name) && !name.endsWith("database.types.ts") ? [path] : [];
  });
}

const RULES: [string, RegExp][] = [
  ["one-off font size (use text-caption … text-hero)", /\btext-\[\d+(px|rem)\]/g],
  ["built-in font size (use the scale: text-small, text-body …)", /\btext-(xs|sm|base|lg|xl|[2-9]xl)\b(?![-\w])/g],
  ["one-off radius (use rounded-input / cta / card / tile / sheet, or rounded-lg / xl / full)", /\brounded(-[trbl]{1,2})?-\[\d+px\]/g],
  ["raw colour (use a colour token)", /\b(bg|text|border|fill|stroke|ring|outline)-\[#[0-9a-fA-F]{3,8}\]/g],
];

describe("design tokens", () => {
  const all = files(ROOT);
  for (const [rule, re] of RULES) {
    it(`no ${rule}`, () => {
      const hits = all.flatMap((f) =>
        readFileSync(f, "utf8")
          .split("\n")
          .flatMap((line, i) => [...line.matchAll(re)].map((m) => `${f.slice(ROOT.length + 1)}:${i + 1} ${m[0]}`)),
      );
      expect(hits).toEqual([]);
    });
  }
});
