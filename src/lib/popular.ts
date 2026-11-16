import type { CategoryId } from "@/lib/engine";

/** "Popular" quick starts under the search (landing + Home): a category and a ready title (i18n `home.pop.*`). */
export const POPULAR: readonly { cat: CategoryId; key: "groceries" | "sofa" | "queue" | "documents" | "tap" }[] = [
  { cat: "shop", key: "groceries" },
  { cat: "carry", key: "sofa" },
  { cat: "queue", key: "queue" },
  { cat: "deliver", key: "documents" },
  { cat: "repair", key: "tap" },
];

/** Seasonal quick starts (Unegui-style "Дулаан өвөл…" row): what people in UB need this time of year. */
export type SeasonKey = "snow" | "battery" | "pharmacy" | "dryClean" | "groceriesCold" | "moveHouse" | "windows" | "bike" | "yard";
export const SEASONAL: Record<"winter" | "warm", readonly { cat: CategoryId; key: SeasonKey }[]> = {
  winter: [
    { cat: "other", key: "snow" },
    { cat: "repair", key: "battery" },
    { cat: "shop", key: "pharmacy" },
    { cat: "deliver", key: "dryClean" },
    { cat: "shop", key: "groceriesCold" },
  ],
  warm: [
    { cat: "carry", key: "moveHouse" },
    { cat: "other", key: "windows" },
    { cat: "repair", key: "bike" },
    { cat: "other", key: "yard" },
  ],
};

/** November–March is winter in Ulaanbaatar (UTC+8). */
export function seasonAt(ms: number): "winter" | "warm" {
  const month = new Date(ms + 8 * 3_600_000).getUTCMonth() + 1;
  return month >= 11 || month <= 3 ? "winter" : "warm";
}
