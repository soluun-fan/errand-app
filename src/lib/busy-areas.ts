import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { busyCells, type BusyCell } from "@/lib/busy-rules";

/** Open tasks across the city, grouped into coarse squares (where a helper starts: pickup, else the task). */
export async function busyAreas(): Promise<BusyCell[]> {
  const { data, error } = await createAdminClient()
    .from("deals")
    .select("lat, lng, pickup_lat, pickup_lng")
    .eq("type", "errand")
    .eq("status", "open")
    .limit(2000)
    .returns<{ lat: number | null; lng: number | null; pickup_lat: number | null; pickup_lng: number | null }[]>();
  if (error) throw error;
  return busyCells((data ?? []).map((d) => ({ lat: d.pickup_lat ?? d.lat, lng: d.pickup_lng ?? d.lng })));
}
