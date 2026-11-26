import type { Metadata } from "next";
import type { MessageKey } from "@/i18n";
import { getT } from "@/i18n/server";

/**
 * A page's browser-tab title from its translated heading — "Profile · Guigere" via the root
 * layout's template. One line per page: `export const generateMetadata = titled("profile.title");`
 */
export function titled(key: MessageKey): () => Promise<Metadata> {
  return async () => ({ title: (await getT())(key) });
}
