import { CONDITION_FLAGS, CUSTOM_CONDITION_LENGTH, CUSTOM_CONDITION_LIMIT, LANGUAGES, type Language, type TaskConditions } from "./types";

/** Public previews use the same allowlist, but never include customer-written text. */
export function cleanConditions(raw: unknown, { includeCustom = true } = {}): TaskConditions | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const input = raw as Record<string, unknown>;
  const result: TaskConditions = {};
  for (const flag of CONDITION_FLAGS) {
    if (input[flag] === true) result[flag] = true;
  }
  if (LANGUAGES.includes(input.language as Language)) result.language = input.language as Language;
  if (includeCustom && Array.isArray(input.custom)) {
    const labels = new Map<string, string>();
    for (const item of input.custom) {
      if (typeof item !== "string") continue;
      const label = item.trim().replace(/\s+/g, " ");
      const key = label.toLowerCase();
      if (!label || label.length > CUSTOM_CONDITION_LENGTH || labels.has(key)) continue;
      labels.set(key, label);
      if (labels.size === CUSTOM_CONDITION_LIMIT) break;
    }
    if (labels.size) result.custom = [...labels.values()];
  }
  return Object.keys(result).length ? result : undefined;
}
