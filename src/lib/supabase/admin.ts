import type { Database } from "@/lib/db/database.types";
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { unverifiedHelpersTestMode } from "@/lib/helper-test-mode";
import { supabaseUrl } from "./env";

/**
 * Service-role client: bypasses RLS. Only server code that has already checked who is
 * acting (via the deal engine) may use it — all money and status writes go through here.
 */
export function createAdminClient(): SupabaseClient<Database> {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("SUPABASE_SECRET_KEY is not set — copy .env.example to .env.local");
  return createClient<Database>(supabaseUrl(), key, {
    global: { headers: { "x-helper-pilot": String(unverifiedHelpersTestMode) } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
