import { maskContacts } from "@/lib/chat-rules";

/**
 * Pure rules for public helper profiles (docs/decisions.md 2026-11-16 "Helper profiles"), tested.
 * Reviews are shown with the reviewer's name masked and any contact details removed.
 */

/** "Солонго" → "С*****"; empty → "***". The reviewer stays anonymous; only the first letter shows. */
export function maskName(name: string | null | undefined): string {
  const n = (name ?? "").trim();
  if (!n) return "***";
  const first = [...n][0];
  return `${first}${"*".repeat(Math.min(5, Math.max(2, [...n].length - 1)))}`;
}

/** A review note made safe to show publicly: trimmed, ≤ 300 chars, phones/links/handles masked. */
export function publicNote(note: string | null | undefined): string | null {
  const t = (note ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  return maskContacts(t.slice(0, 300)).text;
}

/** How often each tag was given, most frequent first; only tags given at least `min` times. */
export function tagCounts(lists: readonly (readonly string[])[], allowed: readonly string[], min = 1): { tag: string; n: number }[] {
  const counts = new Map<string, number>();
  for (const tags of lists) for (const tag of new Set(tags)) if (allowed.includes(tag)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, n]) => n >= min)
    .sort((a, b) => b[1] - a[1] || allowed.indexOf(a[0]) - allowed.indexOf(b[0]))
    .map(([tag, n]) => ({ tag, n }));
}

/** Most saved helpers one customer may keep (keeps the list useful and the table small). */
export const MAX_SAVED_HELPERS = 100;
