import "server-only";
import { createHash } from "node:crypto";
import { adminIds, audit } from "@/lib/safety";
import { notify } from "@/lib/push";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Error alerts (docs/decisions.md 2026-11-18 "Launch readiness"): server and browser errors are
 * grouped in `app_errors`; Ops gets a push the first time a kind of error appears and at most once
 * an hour after. Never throws — logging an error must not cause another.
 */
export interface ErrorReport {
  source: "server" | "client";
  route: string;
  message: string;
  stack?: string | null;
}

/** "/tasks/6f1c…/x?y" → "/tasks/:id/x" so one broken page is one entry, not one per task. */
export function normalizeRoute(path: string): string {
  return (path || "/")
    .split("?")[0]
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
    .replace(/\/\d{4,}/g, "/:n")
    .slice(0, 200);
}

/** Same message with ids / numbers / quoted values removed, for grouping. */
function shape(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
    .replace(/\d+/g, "#")
    .replace(/"[^"]{0,80}"/g, '"…"')
    .slice(0, 300);
}

export async function recordError(r: ErrorReport): Promise<void> {
  try {
    const route = normalizeRoute(r.route);
    const message = (r.message || "Unknown error").replace(/\s+/g, " ").trim().slice(0, 500);
    const fingerprint = createHash("sha256").update(`${r.source}|${route}|${shape(message)}`).digest("hex").slice(0, 32);
    const { data, error } = await createAdminClient().rpc("record_app_error", {
      p_fingerprint: fingerprint,
      p_source: r.source,
      p_route: route,
      p_message: message,
      p_stack: r.stack ? String(r.stack).slice(0, 4000) : null,
    });
    if (error) return console.error("error log failed", error.message);
    if (data === true) {
      await notify(await adminIds(), {
        title: "push.errorTitle",
        body: "push.errorBody",
        params: { where: route, message: message.slice(0, 120) },
        url: "/ops/errors",
        tag: `error-${fingerprint}`,
      });
    }
  } catch (e) {
    console.error("error log failed", e);
  }
}

export interface LoggedError {
  fingerprint: string;
  source: "server" | "client";
  route: string;
  message: string;
  stack: string | null;
  count: number;
  firstAt: number;
  lastAt: number;
}

/** For Ops: errors not marked fixed, most recent first. */
export async function openErrors(limit = 100): Promise<LoggedError[]> {
  const { data } = await createAdminClient()
    .from("app_errors")
    .select("fingerprint, source, route, message, stack, count, first_at, last_at")
    .is("resolved_at", null)
    .order("last_at", { ascending: false })
    .limit(limit)
    .returns<{ fingerprint: string; source: "server" | "client"; route: string; message: string; stack: string | null; count: number; first_at: string; last_at: string }[]>();
  return (data ?? []).map((r) => ({ ...r, count: Number(r.count), firstAt: Date.parse(r.first_at), lastAt: Date.parse(r.last_at) }));
}

export async function openErrorCount(): Promise<number> {
  const { count } = await createAdminClient().from("app_errors").select("fingerprint", { count: "exact", head: true }).is("resolved_at", null);
  return count ?? 0;
}

/** Ops marks a kind of error fixed; it reopens (and alerts again) if it happens again. Logged. */
export async function resolveError(fingerprint: string, opsId: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .from("app_errors")
    .update({ resolved_at: new Date().toISOString(), resolved_by: opsId })
    .eq("fingerprint", fingerprint)
    .is("resolved_at", null)
    .select("fingerprint");
  if (!data?.length) return false;
  await audit(opsId, "errors.resolve", fingerprint, {});
  return true;
}
