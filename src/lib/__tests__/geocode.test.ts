import { expect, it } from "vitest";
import { parsePhoton } from "@/lib/geocode";

it("keeps places in Mongolia with a short name and where-it-is detail, no duplicates", () => {
  const body = {
    features: [
      { geometry: { coordinates: [106.9177, 47.9186] }, properties: { osm_type: "N", osm_id: 1, name: "Төв шуудан", street: "Энхтайваны өргөн чөлөө", district: "Чингэлтэй", city: "Улаанбаатар" } },
      { geometry: { coordinates: [106.9177, 47.9186] }, properties: { osm_type: "N", osm_id: 2, name: "Төв шуудан", city: "Улаанбаатар" } }, // duplicate spot
      { geometry: { coordinates: [106.92, 47.92] }, properties: { osm_type: "W", osm_id: 3, street: "Сөүлийн гудамж", housenumber: "12", city: "Улаанбаатар" } },
      { geometry: { coordinates: [13.4, 52.5] }, properties: { name: "Berlin" } }, // outside Mongolia
      { geometry: {}, properties: { name: "no coordinates" } },
    ],
  };
  expect(parsePhoton(body)).toEqual([
    { id: "N1", name: "Төв шуудан", detail: "Энхтайваны өргөн чөлөө, Чингэлтэй, Улаанбаатар", lat: 47.9186, lng: 106.9177 },
    { id: "W3", name: "Сөүлийн гудамж 12", detail: "Улаанбаатар", lat: 47.92, lng: 106.92 },
  ]);
  expect(parsePhoton(null)).toEqual([]);
  // traditional script and the Russian city name are tidied away
  expect(parsePhoton({ features: [{ geometry: { coordinates: [106.9, 47.9] }, properties: { osm_type: "N", osm_id: 9, name: "Сансар", district: "Бага Тойрог \u182a\u1820\u182d", city: "Улан-Батор" } }] }))
    .toEqual([{ id: "N9", name: "Сансар", detail: "Бага Тойрог, Улаанбаатар", lat: 47.9, lng: 106.9 }]);
});
