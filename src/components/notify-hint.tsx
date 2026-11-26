"use client";

import { Bell, X } from "lucide-react";
import { useEffect, useState } from "react";
import { savePush } from "@/app/(app)/jobs/actions";
import { useT } from "@/i18n/client";
import { btn } from "./ui";

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Customers: a clear "turn on notifications" card while they're off on this device (owner,
 * 2026-11-18 — mandatory for helpers, strongly asked of customers: payment windows are minutes long).
 * Hidden when on, or when this browser can't do it.
 */
const LATER = "notify-hint-later";

export function NotifyHint() {
  const t = useT();
  const [state, setState] = useState<"hidden" | "off" | "busy">("hidden");
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  useEffect(() => {
    if (!publicKey || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return;
    if (Notification.permission === "denied") return;
    try {
      // "Later" hides it on this device for a week
      if (Number(localStorage.getItem(LATER) ?? 0) > Date.now()) return;
    } catch { /* storage unavailable */ }
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        if (sub) {
          const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
          void savePush({ endpoint: j.endpoint, keys: j.keys }); // make sure the server still has it
        } else setState("off");
      })
      .catch(() => undefined);
  }, [publicKey]);

  async function turnOn() {
    setState("busy");
    try {
      if ((await Notification.requestPermission()) !== "granted") return setState("hidden");
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey as string) }));
      const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await savePush({ endpoint: j.endpoint, keys: j.keys });
      setState("hidden");
    } catch {
      setState("off");
    }
  }

  const later = () => {
    try {
      localStorage.setItem(LATER, String(Date.now() + 7 * 86_400_000));
    } catch { /* storage unavailable */ }
    setState("hidden");
  };

  if (state === "hidden") return null;
  return (
    <section className="flex flex-wrap items-center gap-3 rounded-card bg-bg p-3 shadow-card">
      <span aria-hidden className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-brand-bg text-brand-ink">
        <Bell size={18} />
      </span>
      {/* text gets the room; on narrow phones the button drops below it instead of squeezing it */}
      <span className="min-w-0 flex-1 basis-52">
        <span className="block text-body font-semibold">{t("notifyHint.title")}</span>
        <span className="block text-meta leading-snug text-ink-2">{t("notifyHint.body")}</span>
      </span>
      <button type="button" disabled={state === "busy"} onClick={turnOn} className={`${btn.primary} order-last w-full flex-none px-4 sm:order-none sm:w-auto`}>
        {t("notifyHint.go")}
      </button>
      <button type="button" aria-label={t("install.dismiss")} onClick={later} className="-ml-1 flex h-11 w-9 flex-none items-center justify-center text-ink-3">
        <X aria-hidden size={18} />
      </button>
    </section>
  );
}
