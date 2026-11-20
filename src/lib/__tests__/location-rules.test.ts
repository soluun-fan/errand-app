import { expect, it } from "vitest";
import { freshPosition, LOCATION_FRESH_MS, missingTable } from "../location-rules";

it("expires live coordinates, including during a lost connection", () => {
  const now = Date.now();
  const point = { lat: 47.92, lng: 106.92, updatedAt: now };
  expect(freshPosition(point, now + 89_999)).toEqual(point);
  expect(freshPosition(point, now + LOCATION_FRESH_MS)).toBeNull();
  expect(freshPosition({ ...point, updatedAt: NaN }, now)).toBeNull();
  expect(freshPosition({ ...point, updatedAt: now + 60_000 }, now)).toBeNull();
  expect(freshPosition({ ...point, lat: 100 }, now)).toBeNull();
  expect(freshPosition({ ...point, lng: NaN }, now)).toBeNull();
  expect(freshPosition(null, now)).toBeNull();
});

it("recognizes only the named missing table, without hiding access or network errors", () => {
  expect(missingTable({ code: "PGRST205", message: "Could not find public.job_locations in the schema cache" }, "job_locations")).toBe(true);
  expect(missingTable({ code: "42P01", message: "relation public.job_locations does not exist" }, "job_locations")).toBe(true);
  expect(missingTable({ code: "42501", message: "permission denied for job_locations" }, "job_locations")).toBe(false);
  expect(missingTable({ code: "PGRST205", message: "Could not find profiles" }, "job_locations")).toBe(false);
});
