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
  "id, name, phone, role, kyc_level, helper_status, verified_name, categories, area, suspended_until, age_confirmed_at, test_helper, terms_version, privacy_version, helper_terms_version, deleted_at";
const PROFILE_COLUMNS_WITHOUT_TEST_HELPER =
  "id, name, phone, role, kyc_level, helper_status, verified_name, categories, area, suspended_until, age_confirmed_at, terms_version, privacy_version, helper_terms_version, deleted_at";
const LEGACY_PROFILE_COLUMNS =
  "id, name, phone, role, kyc_level, helper_status, verified_name, categories, area, suspended_until, birth_date, terms_version, privacy_version, helper_terms_version, deleted_at";

type LegacyProfileRow = Omit<ProfileRow, "age_confirmed_at" | "test_helper"> & { birth_date: string | null };

function missingProfileColumn(error: { code?: string; message?: string }, column: string): boolean {
  return (error.code === "42703" || error.code === "PGRST204") && new RegExp(`\\b${column}\\b`).test(error.message ?? "");
}

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

  const db = createAdminClient();
  type ProfileVariant = "current" | "without-test-helper" | "legacy";
  let variant: ProfileVariant = "current";
  let profile: ProfileRow | null = null;
  let error: { code?: string; message?: string } | null = null;

  for (;;) {
    if (variant === "legacy") {
      const result = await db.from("profiles").select(LEGACY_PROFILE_COLUMNS).eq("id", sub).single<LegacyProfileRow>();
      error = result.error;
      profile = result.data
        ? {
            ...result.data,
            age_confirmed_at: result.data.birth_date ? "legacy-confirmed" : null,
            test_helper: false,
          }
        : null;
    } else {
      const columns = variant === "current" ? PROFILE_COLUMNS : PROFILE_COLUMNS_WITHOUT_TEST_HELPER;
      const result = await db.from("profiles").select(columns).eq("id", sub).single<ProfileRow>();
      error = result.error;
      profile = result.data
        ? {
            ...result.data,
            ...(variant === "without-test-helper" ? { test_helper: false } : {}),
          }
        : null;
    }

    const currentError = error;
    if (!currentError) break;
    const missingColumn = ["age_confirmed_at", "test_helper"].find((column) =>
      missingProfileColumn(currentError, column),
    );
    if (!missingColumn) break;
    if (missingColumn === "age_confirmed_at") {
      if (variant === "legacy") break;
      variant = "legacy";
    } else {
      if (variant === "without-test-helper") break;
      variant = "without-test-helper";
    }
  }
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
