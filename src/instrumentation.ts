import type { Instrumentation } from "next";

/**
 * Server errors → the Ops error log + a push (src/lib/error-log.ts). Node runtime only (the log
 * writes to the database). Awaited, as Next.js asks.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const e = err as { message?: unknown; stack?: unknown; digest?: unknown };
  const message = typeof e?.message === "string" ? e.message : String(err);
  const { recordError } = await import("@/lib/error-log");
  await recordError({
    source: "server",
    route: `${context.routerKind === "App Router" ? "" : "[pages] "}${request.path}`,
    message: e?.digest ? `${message} (digest ${String(e.digest)})` : message,
    stack: typeof e?.stack === "string" ? e.stack : null,
  });
};
