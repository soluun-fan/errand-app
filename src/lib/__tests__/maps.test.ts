import { describe, expect, it } from "vitest";
import { distanceKm } from "@/lib/dispatch/plan";
import { fuzz, googleDirectionsUrl, googlePlaceUrl } from "@/lib/maps";

describe("Google Maps links", () => {
  it("directions to a pin, optionally via a pickup (pin or text)", () => {
    const u = new URL(googleDirectionsUrl({ lat: 47.9186, lng: 106.9177 }, "Nomin supermarket, Zaisan"));
    expect(u.origin + u.pathname).toBe("https://www.google.com/maps/dir/");
    expect(u.searchParams.get("api")).toBe("1");
    expect(u.searchParams.get("destination")).toBe("47.9186,106.9177");
    expect(u.searchParams.get("waypoints")).toBe("Nomin supermarket, Zaisan");
    expect(new URL(googleDirectionsUrl("8th khoroo")).searchParams.has("waypoints")).toBe(false);
  });

  it("place link", () => {
    expect(new URL(googlePlaceUrl({ lat: 1, lng: 2 })).searchParams.get("query")).toBe("1,2");
  });
});

describe("fuzz", () => {
  it("moves a pin by at most ~300 m and is stable", () => {
    const p = { lat: 47.918612, lng: 106.917733 };
    const f = fuzz(p);
    expect(distanceKm(p, f)).toBeLessThan(0.3);
    expect(fuzz(f)).toEqual(f);
    expect(fuzz({ lat: 47.9187, lng: 106.9178 })).toEqual(f); // nearby homes share a cell
  });
});
