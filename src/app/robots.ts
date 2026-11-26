import type { MetadataRoute } from "next";
import { PUBLIC_PAGES, indexable, siteOrigin } from "@/lib/site";

/** Search engines see the public pages only — never the app, Ops or the API; staging not at all. */
export default async function robots(): Promise<MetadataRoute.Robots> {
  if (!indexable()) return { rules: { userAgent: "*", disallow: "/" } };
  const origin = await siteOrigin();
  return {
    rules: { userAgent: "*", allow: [...PUBLIC_PAGES], disallow: "/" },
    sitemap: `${origin}/sitemap.xml`,
  };
}
