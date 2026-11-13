/** Customer ↔ helper mode switch (UI-FLOWS §1). Stored in a cookie so the server renders the right tab bar. */
export type AppMode = "customer" | "helper";
export const MODE_COOKIE = "mode";
export const parseMode = (v: string | undefined | null): AppMode => (v === "helper" ? "helper" : "customer");
