"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { LOCALE_COOKIE, parseLocale } from "@/i18n";

import { MODE_COOKIE, modeCookieValue, type AppMode } from "./mode-cookie";
import { getViewer } from "./auth";

const YEAR = 60 * 60 * 24 * 365;

export async function setLocale(form: FormData): Promise<void> {
  (await cookies()).set(LOCALE_COOKIE, parseLocale(String(form.get("locale"))), { path: "/", maxAge: YEAR, sameSite: "lax" });
  refresh();
}

export async function setMode(form: FormData): Promise<void> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const mode: AppMode = form.get("mode") === "helper" ? "helper" : "customer";
  (await cookies()).set(MODE_COOKIE, modeCookieValue(viewer.profile.id, mode), { path: "/", maxAge: YEAR, sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production" });
  // Land on that mode's home, like switching tabs in the reference apps.
  redirect(mode === "helper" ? "/jobs" : "/");
}
