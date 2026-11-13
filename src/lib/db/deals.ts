/**
 * Deal repository: the only place that writes deals. Load → engine.apply → one atomic RPC.
 *
 * Takes the Supabase client as a parameter (service-role in the app, see
 * src/lib/supabase/admin.ts) so scripts and tests can reuse it.
 */
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { EngineError, apply, type Actor, type Command, type Deal, type Transition } from "@/lib/engine";
import { applyTransitionArgs, dealFromRow, insertDealArgs, type DealRow, type DisputeRow, type OfferRow } from "./mapping";

export class DbError extends Error {
  readonly code: string | undefined;
  constructor(err: PostgrestError | { message: string; code?: string }) {
    super(err.message);
    this.name = "DbError";
    this.code = err.code;
  }
}

/** SQLSTATE raised by apply_transition() when someone else changed the deal first. */
const CONFLICT = "PT409";

export async function loadDeal(db: SupabaseClient, id: string): Promise<Deal | null> {
  const [deal, offers, dispute] = await Promise.all([
    db.from("deals").select("*").eq("id", id).maybeSingle<DealRow>(),
    db.from("offers").select("helper_id, note, created_at").eq("deal_id", id).order("created_at").returns<OfferRow[]>(),
    db.from("disputes").select("*").eq("deal_id", id).maybeSingle<DisputeRow>(),
  ]);
  for (const r of [deal, offers, dispute]) if (r.error) throw new DbError(r.error);
  return deal.data ? dealFromRow(deal.data, offers.data ?? [], dispute.data) : null;
}

/** Persists a deal fresh from createErrand()/createGoods(). */
export async function insertDeal(db: SupabaseClient, t: Transition): Promise<void> {
  const { error } = await db.rpc("insert_deal", insertDealArgs(t));
  if (error) throw new DbError(error);
}

/**
 * Runs one engine command against the stored deal. On a version conflict (a concurrent
 * write won) it reloads and re-applies, so e.g. a second "accept" fails cleanly with the
 * engine's ILLEGAL_TRANSITION instead of overwriting the first helper.
 *
 * Throws EngineError for rule violations, DbError for storage failures.
 */
export async function runCommand(
  db: SupabaseClient,
  dealId: string,
  cmd: Command,
  actor: Actor,
  opts: { now?: () => number; attempts?: number } = {},
): Promise<Transition> {
  const attempts = opts.attempts ?? 3;
  for (let attempt = 1; ; attempt++) {
    const before = await loadDeal(db, dealId);
    if (!before) throw new EngineError("INVALID_INPUT", "Deal not found");
    const now = opts.now?.() ?? Date.now();
    const t = apply(before, cmd, { now, actor });
    if (t.duplicate) return t;

    const { error } = await db.rpc("apply_transition", applyTransitionArgs(before, t, now));
    if (!error) return t;
    if (error.code === CONFLICT && attempt < attempts) continue;
    throw new DbError(error);
  }
}
