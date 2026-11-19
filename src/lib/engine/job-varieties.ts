import type { CategoryId } from "./config";

export const JOB_VARIETIES = {
  shop: ["groceries", "household"],
  carry: ["furnitureMove", "boxMove"],
  queue: ["officeQueue", "ticketQueue"],
  deliver: ["documents", "parcel"],
  repair: ["doorAdjustment", "drawerRepair"],
  other: ["plantWatering", "giftWrapping"],
  dayjob: ["eventSetup", "stockPacking"],
  trash: ["cardboard", "baggedWaste"],
  escort: ["appointment", "wayfinding"],
  assembly: ["deskAssembly", "shelfAssembly"],
  plumbing: ["tapRepair", "drain"],
  electrical: ["lightFixture", "socketRepair"],
  cleaning: ["moveOutClean", "kitchenClean"],
  childcare: ["playtime", "eveningRoutine"],
  eldercare: ["companionship", "mealPrep"],
} as const satisfies Record<CategoryId, readonly string[]>;

export type JobVariety = (typeof JOB_VARIETIES)[CategoryId][number];

export function varietyFor(category: CategoryId, raw: unknown): JobVariety | undefined {
  return JOB_VARIETIES[category]?.find(id => id === raw);
}
