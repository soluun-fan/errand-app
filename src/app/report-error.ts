"use server";

import { getViewer } from "@/lib/auth";
import { recordError } from "@/lib/error-log";

/**
 * A browser error, sent by the page (src/components/error-reporter.tsx and the error screens).
 * Signed-in people only, short fields only; grouping and the hourly alert limit are in the database.
 */
export async function reportClientError(message: unknown, stack: unknown, path: unknown): Promise<void> {
  if (!(await getViewer())) return;
  if (typeof message !== "string" || !message.trim()) return;
  await recordError({
    source: "client",
    route: typeof path === "string" ? path.slice(0, 200) : "/",
    message: message.slice(0, 500),
    stack: typeof stack === "string" ? stack.slice(0, 4000) : null,
  });
}
