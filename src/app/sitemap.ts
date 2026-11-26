import type { MetadataRoute } from "next";
import { PUBLIC_PAGES, indexable, siteOrigin } from "@/lib/site";

/** The public pages, for search engines (production only). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!indexable()) return [];
  const origin = await siteOrigin();
  return PUBLIC_PAGES.map((path) => ({ url: `${origin}${path}`, priority: path === "/welcome" ? 1 : 0.5 }));
}
