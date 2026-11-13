import "server-only";
import type { Lift } from "@/lib/engine";
import { createClient } from "@/lib/supabase/server";

export type AddressKind = "home" | "work" | "other";
export const ADDRESS_KINDS: readonly AddressKind[] = ["home", "work", "other"];
/** Cap on "Бусад" addresses per person (Home and Work are one each, enforced by the DB). */
export const MAX_OTHER_ADDRESSES = 5;

export interface SavedAddress {
  id: string;
  kind: AddressKind;
  label: string | null;
  address: string;
  entrance: string | null;
  floor: number | null;
  unit: string | null;
  lift: Lift | null;
  note: string | null;
}

const COLUMNS = "id, kind, label, address, entrance, floor, unit, lift, note";
const ORDER: Record<AddressKind, number> = { home: 0, work: 1, other: 2 };

/**
 * Saved addresses (docs/decisions.md 2026-11-13). Uses the signed-in user's client, so RLS keeps
 * each person to their own rows — never the service role here.
 */
export async function listSavedAddresses(): Promise<SavedAddress[]> {
  const db = await createClient();
  const { data, error } = await db.from("saved_addresses").select(COLUMNS).order("created_at").returns<SavedAddress[]>();
  if (error) throw error;
  return (data ?? []).sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
}

export type AddressInput = Omit<SavedAddress, "id">;

/** Home / Work replace the previous one; Бусад adds a new row (same address = no duplicate). */
export async function saveAddress(input: AddressInput, userId: string): Promise<void> {
  const db = await createClient();
  const row = { ...input, address: input.address.trim().slice(0, 200), updated_at: new Date().toISOString() };
  if (!row.address) return;
  if (input.kind === "other") {
    const { data: existing } = await db.from("saved_addresses").select("id, address").eq("kind", "other");
    const same = existing?.find((e) => e.address === row.address);
    if (same) {
      await db.from("saved_addresses").update(row).eq("id", same.id).throwOnError();
      return;
    }
    if ((existing?.length ?? 0) >= MAX_OTHER_ADDRESSES) return;
    await db.from("saved_addresses").insert({ ...row, user_id: userId }).throwOnError();
    return;
  }
  const { data: updated } = await db.from("saved_addresses").update(row).eq("kind", input.kind).select("id").throwOnError();
  if (!updated?.length) await db.from("saved_addresses").insert({ ...row, user_id: userId }).throwOnError();
}

export async function deleteAddress(id: string): Promise<void> {
  const db = await createClient();
  await db.from("saved_addresses").delete().eq("id", id).throwOnError();
}
