/**
 * An error whose message is already written for the person (a translated string or an action's
 * `{error}`). Anything else thrown — a network drop, a server crash — may carry English or
 * framework text, so screens show their own translated fallback instead.
 */
export class UserError extends Error {}

/** The text to show for a caught error: its own message only if it was written for the person. */
export const shownError = (e: unknown, fallback: string): string => (e instanceof UserError && e.message ? e.message : fallback);
