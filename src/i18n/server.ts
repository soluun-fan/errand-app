import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { LOCALE_COOKIE, MESSAGES, makeT, parseLocale, type Locale, type T } from "./index";

export const getLocale = cache(async (): Promise<Locale> => parseLocale((await cookies()).get(LOCALE_COOKIE)?.value));

/** Translator for Server Components and Server Actions. */
export const getT = cache(async (): Promise<T> => makeT(MESSAGES[await getLocale()]));
