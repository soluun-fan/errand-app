"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { MESSAGES, makeT, type Locale, type T } from "./index";

const Ctx = createContext<{ locale: Locale; t: T } | null>(null);

/** Both dictionaries are small, so the client gets them bundled and only the locale crosses the wire. */
export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo(() => ({ locale, t: makeT(MESSAGES[locale]) }), [locale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useT(): T {
  const c = useContext(Ctx);
  if (!c) throw new Error("useT() outside <I18nProvider>");
  return c.t;
}

export function useLocale(): Locale {
  const c = useContext(Ctx);
  if (!c) throw new Error("useLocale() outside <I18nProvider>");
  return c.locale;
}
