import { expect, it } from "vitest";
import { busyCells } from "@/lib/busy-rules";

it("counts open tasks per ~1 km square, busiest first, and never returns an exact spot", () => {
  const cells = busyCells([
    { lat: 47.9181, lng: 106.9172 },
    { lat: 47.9149, lng: 106.9111 }, // same square
    { lat: 47.9312, lng: 106.8805 },
    { lat: null, lng: 106.9 },
  ]);
  expect(cells).toEqual([
    { lat: 47.915, lng: 106.915, count: 2 },
    { lat: 47.935, lng: 106.885, count: 1 },
  ]);
  expect(busyCells([], 30)).toEqual([]);
});
