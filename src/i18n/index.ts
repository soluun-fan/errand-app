import { en, type Messages } from "./en";
import { mn } from "./mn";

export type Locale = "mn" | "en";
export const LOCALES: Locale[] = ["mn", "en"];
export const DEFAULT_LOCALE: Locale = "mn";
export const LOCALE_COOKIE = "lang";

export const MESSAGES: Record<Locale, Messages> = { mn, en };

/** Dotted keys of every leaf string, e.g. "deal.line.check". */
type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];
export type MessageKey = Leaves<Messages>;

export type Params = Record<string, string | number>;
export type T = (key: MessageKey, params?: Params) => string;

export function parseLocale(v: string | undefined | null): Locale {
  return v === "en" ? "en" : DEFAULT_LOCALE;
}

export function makeT(messages: Messages): T {
  return (key, params) => {
    let node: unknown = messages;
    for (const part of key.split(".")) node = (node as Record<string, unknown> | undefined)?.[part];
    const s = typeof node === "string" ? node : key; // a missing key shows itself, never crashes
    return params ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : s;
  };
}

/** Locale tag for Intl date formatting. */
export const intlLocale = (l: Locale) => (l === "mn" ? "mn-MN" : "en-GB");
