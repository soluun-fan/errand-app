import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export async function shouldShowDesktopWorkNotice(userId: string): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from("desktop_work_notice_preferences")
    .select("hidden")
    .eq("user_id", userId)
    .maybeSingle<{ hidden: boolean }>();
  if (error) throw new Error(`Could not load desktop-work notice preference: ${error.message}`);
  return data?.hidden !== true;
}
