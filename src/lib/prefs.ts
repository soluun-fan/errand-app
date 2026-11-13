"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { LOCALE_COOKIE, parseLocale } from "@/i18n";

import { MODE_COOKIE, type AppMode } from "./mode-cookie";

const YEAR = 60 * 60 * 24 * 365;

export async function setLocale(form: FormData): Promise<void> {
  (await cookies()).set(LOCALE_COOKIE, parseLocale(String(form.get("locale"))), { path: "/", maxAge: YEAR, sameSite: "lax" });
  refresh();
}

export async function setMode(form: FormData): Promise<void> {
  const mode: AppMode = form.get("mode") === "helper" ? "helper" : "customer";
  (await cookies()).set(MODE_COOKIE, mode, { path: "/", maxAge: YEAR, sameSite: "lax" });
  // Land on that mode's home, like switching tabs in the reference apps.
  redirect(mode === "helper" ? "/jobs" : "/");
}
