"use client";

import { useEffect, useState } from "react";
import { removePush, savePush } from "@/app/(app)/jobs/actions";
import { useT } from "@/i18n/client";
import { btn } from "./ui";

type State = "loading" | "unsupported" | "off" | "on" | "denied";

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Turn Web Push on/off for this device (service worker at /sw.js). */
export function PushToggle() {
  const t = useT();
  const [state, setState] = useState<State>("loading");
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  useEffect(() => {
    if (!publicKey || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setState(sub ? "on" : "off"))
      .catch(() => setState("unsupported"));
  }, [publicKey]);

  async function turnOn() {
    setState("loading");
    try {
      if ((await Notification.requestPermission()) !== "granted") return setState("denied");
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey as string) }));
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await savePush({ endpoint: json.endpoint, keys: json.keys });
      setState("on");
    } catch {
      setState("off");
    }
  }

  async function turnOff() {
    setState("loading");
    const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
    if (sub) {
      await removePush(sub.endpoint);
      await sub.unsubscribe();
    }
    setState("off");
  }

  const sub =
    state === "on"
      ? t("job.notificationsOn")
      : state === "unsupported"
        ? t("job.notificationsUnsupported")
        : state === "denied"
          ? t("job.notificationsDenied")
          : t("job.notificationsOff");

  return (
    <div className="flex items-center gap-3">
      <span aria-hidden className="flex h-11 w-11 flex-none items-center justify-center rounded-input bg-fill text-xl">
        🔔
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold">{t("job.notifications")}</span>
        <span className="block text-sm text-ink-2">{sub}</span>
      </span>
      {(state === "off" || state === "on") && (
        <button type="button" onClick={state === "on" ? turnOff : turnOn} className={state === "on" ? btn.secondary : btn.small}>
          {state === "on" ? t("job.turnOff") : t("job.turnOn")}
        </button>
      )}
    </div>
  );
}
