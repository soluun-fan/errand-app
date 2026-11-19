"use client";

import { createBrowserClient } from "@supabase/ssr";
import { supabasePublishableKey, supabaseUrl } from "./env";

/**
 * Browser client (publishable key; RLS applies). Used for Google OAuth and signed file uploads.
 */
export function browserClient() {
  return createBrowserClient(supabaseUrl(), supabasePublishableKey());
}
