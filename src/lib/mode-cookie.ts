/** UI preference only; never use this cookie to authorize work or payments. */
export type AppMode = "customer" | "helper";
export const MODE_COOKIE = "mode";

export const modeCookieValue = (userId: string, mode: AppMode): string => `${userId}:${mode}`;

/** Ignore legacy browser-wide preferences and preferences left by another account. */
export function parseMode(value: string | undefined | null, userId: string | undefined | null): AppMode {
  return userId && value === modeCookieValue(userId, "helper") ? "helper" : "customer";
}

/** Deep links keep navigation appropriate to the screen without changing the saved home mode. */
export function modeForPath(path: string, preferred: AppMode): AppMode {
  const within = (root: string) => path === root || path.startsWith(`${root}/`);
  if (["/jobs", "/earnings", "/helper"].some(within)) return "helper";
  if (["/tasks", "/post"].some(within)) return "customer";
  return preferred;
}
