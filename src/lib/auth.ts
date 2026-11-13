import "server-only";
import { cache } from "react";
import { actorFromProfile, type ProfileRow } from "@/lib/db/mapping";
import type { UserActor } from "@/lib/engine";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export interface Viewer {
  profile: ProfileRow;
  /** Pass this to the engine as the acting user. */
  actor: UserActor;
}

const PROFILE_COLUMNS =
  "id, name, phone, role, kyc_level, helper_status, verified_name, categories, area, suspended_until";

/**
 * The signed-in user, verified (getClaims checks the JWT signature), or null.
 * Cached per request, so layouts and pages can both call it.
 *
 * The profile is read with the service role: phone, ДАН name and suspension are not
 * readable by clients at all (column privileges), only by server code like this.
 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  if (!sub) return null;

  const { data: profile, error } = await createAdminClient()
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", sub)
    .single<ProfileRow>();
  if (error || !profile) return null;
  return { profile, actor: actorFromProfile(profile, Date.now()) };
});
