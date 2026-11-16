import type { CategoryId } from "@/lib/engine";

/** "Popular" quick starts under the search (landing + Home): a category and a ready title (i18n `home.pop.*`). */
export const POPULAR: readonly { cat: CategoryId; key: "groceries" | "sofa" | "queue" | "documents" | "tap" }[] = [
  { cat: "shop", key: "groceries" },
  { cat: "carry", key: "sofa" },
  { cat: "queue", key: "queue" },
  { cat: "deliver", key: "documents" },
  { cat: "repair", key: "tap" },
];
