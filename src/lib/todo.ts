import "server-only";
import type { ErrandDeal } from "@/lib/engine";
import type { Viewer } from "@/lib/auth";
import { latestApplication } from "@/lib/kyc";
import { getRules } from "@/lib/rules";
import { LEGAL_VERSIONS } from "@/lib/legal-rules";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * "Хийх зүйл" — everything the app is waiting for from this person, each with the one page where
 * they do it (owner, 2026-11-18: "if the app is requiring stuff, make it a path, very visible, where
 * I can click and go and input my stuff"). Items without a page (e.g. "in review") say what happens next.
 */
export type TodoKey =
  | "helperApply"
  | "helperFix"
  | "helperReview"
  | "bankAdd"
  | "bankCheck"
  | "workKinds"
  | "withdraw"
  | "helperTerms"
  | "pay"
  | "payExtra"
  | "confirm"
  | "priceAnswer"
  | "photosAsk";

export interface Todo {
  key: TodoKey;
  /** where to go; null = nothing to do but wait (shown as information) */
  href: string | null;
  /** e.g. the task's title */
  detail?: string;
  /** urgent ones first and highlighted */
  urgent?: boolean;
}

/** What a helper (or someone becoming one) still has to do. */
export async function helperTodos(viewer: Viewer): Promise<Todo[]> {
  const { profile, actor } = viewer;
  const out: Todo[] = [];
  if (!actor.helperApproved) {
    const app = await latestApplication(profile.id);
    if (app?.status === "submitted") out.push({ key: "helperReview", href: null });
    else if (app?.status === "changes_requested" || app?.status === "rejected") out.push({ key: "helperFix", href: "/helper/apply", detail: app.decisionNote ?? undefined, urgent: true });
    else out.push({ key: "helperApply", href: "/helper/apply", urgent: true });
    return out;
  }
  const db = createAdminClient();
  const [{ data: acct }, { data: available }, rules] = await Promise.all([
    db.from("payout_accounts").select("verified_at").eq("user_id", profile.id).maybeSingle<{ verified_at: string | null }>(),
    db.rpc("payable_balance", { p_user: profile.id }),
    getRules(),
  ]);
  if (profile.helper_terms_version !== LEGAL_VERSIONS.helper) out.push({ key: "helperTerms", href: "/helper-terms", urgent: true });
  if (!acct) out.push({ key: "bankAdd", href: "/helper/bank", urgent: true });
  else if (!acct.verified_at) out.push({ key: "bankCheck", href: null });
  if (!(profile.categories ?? []).length) out.push({ key: "workKinds", href: "/profile#work-kinds", urgent: true });
  if (acct?.verified_at && Number(available ?? 0) >= Math.max(1, rules.withdrawMin)) out.push({ key: "withdraw", href: "/earnings" });
  return out;
}

/** What a customer's own tasks are waiting for from them (pay, confirm, answer). */
export async function customerTodos(viewerId: string, deals: readonly ErrandDeal[]): Promise<Todo[]> {
  const mine = deals.filter((d) => d.customerId === viewerId);
  const out: Todo[] = [];
  for (const d of mine) {
    const href = `/tasks/${d.id}`;
    if (d.status === "awaiting_payment") out.push({ key: "pay", href, detail: d.title, urgent: true });
    else if (d.topUp?.status === "pending" || d.priceChange?.status === "awaiting_payment") out.push({ key: "payExtra", href, detail: d.title, urgent: true });
    else if (d.priceChange?.status === "proposed" && d.priceChange.by === "helper") out.push({ key: "priceAnswer", href, detail: d.title, urgent: true });
    else if (d.status === "check") out.push({ key: "confirm", href, detail: d.title, urgent: true });
  }
  // a helper asked to show photos of a finished job in their portfolio
  const released = mine.filter((d) => d.status === "released").map((d) => d.id);
  if (released.length) {
    const { data } = await createAdminClient().from("work_photos").select("deal_id").in("deal_id", released.slice(0, 100)).eq("status", "asked").returns<{ deal_id: string }[]>();
    for (const id of new Set((data ?? []).map((r) => r.deal_id))) {
      const d = mine.find((x) => x.id === id);
      out.push({ key: "photosAsk", href: `/tasks/${id}`, detail: d?.title });
    }
  }
  return out;
}
