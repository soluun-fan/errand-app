"use client";

import { createBrowserClient } from "@supabase/ssr";
import { supabasePublishableKey, supabaseUrl } from "./env";

/**
 * Browser client (publishable key; RLS applies). Used only to upload proof files to a signed
 * upload URL the server issued — the token in that URL is what authorises the upload.
 */
export function browserClient() {
  return createBrowserClient(supabaseUrl(), supabasePublishableKey());
}
