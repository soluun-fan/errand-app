import "server-only";
import { cache } from "react";
import { actorFromProfile, type ProfileRow } from "@/lib/db/mapping";
import type { UserActor } from "@/lib/engine";
import { qualificationsFor } from "@/lib/qualifications";
import { badgesFor } from "@/lib/badges";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export interface Viewer {
  profile: ProfileRow;
  /** Pass this to the engine as the acting user. */
  actor: UserActor;
}

const PROFILE_COLUMNS =
  "id, name, phone, role, kyc_level, helper_status, verified_name, categories, area, suspended_until, birth_date, terms_version, privacy_version, helper_terms_version, deleted_at";

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
  if (profile.deleted_at) return null; // a closed account is signed out everywhere
  const actor = actorFromProfile(profile, Date.now());
  // specialized work: what organisations vouch for them / which certificates Ops approved
  if (actor.helperApproved) {
    const [qualified, badges] = await Promise.all([qualificationsFor(profile.id, profile.kyc_level), badgesFor(profile.id, profile.kyc_level)]);
    actor.qualified = qualified;
    actor.badges = badges; // task conditions, including legacy checks on old tasks
  }
  return { profile, actor };
});
