"use client";

import { Bell, MapPin, Share, Smartphone } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { reportPosition, savePush } from "@/app/(app)/jobs/actions";
import { useT } from "@/i18n/client";
import { isMobileDevice } from "@/lib/work-ready-rules";
import { btn } from "./ui";

/**
 * "failed": asked but it didn't work (no location found, the browser refused quietly) — said, with a retry.
 * "nokey": this site has no notification key configured (a server setting, not the person's browser).
 */
type Perm = "loading" | "on" | "off" | "denied" | "unsupported" | "failed" | "nokey";

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const isIos = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1);
const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/**
 * "Ready to work" (owner, 2026-11-18: errands run on phones, location and notifications on — or
 * no errand). Shows its children (online switch, apply / start buttons) only when this device is a
 * phone with notifications and location on; otherwise a checklist with one button per step. The
 * server checks the same (src/lib/work-ready.ts). `enforce` is false only for browser tests.
 */
export function WorkReady({
  enforce,
  computerOk = false,
  children,
}: {
  enforce: boolean;
  /** Ops let this helper work from a computer: the phone step counts as done (2026-11-27). */
  computerOk?: boolean;
  children: ReactNode;
}) {
  const t = useT();
  const [mounted, setMounted] = useState(false);
  const [phone, setPhone] = useState(true);
  const [ios, setIos] = useState(false);
  const [installed, setInstalled] = useState(true);
  const [push, setPush] = useState<Perm>("loading");
  const [geo, setGeo] = useState<Perm>("loading");
  const [checked, setChecked] = useState(false);
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  const sendPosition = useCallback(() => {
    if (!navigator.geolocation) {
      setGeo("unsupported");
      return;
    }
    setGeo("loading");
    navigator.geolocation.getCurrentPosition(
      async (p) => {
        try {
          setGeo((await reportPosition(p.coords.latitude, p.coords.longitude)) ? "on" : "failed");
        } catch {
          setGeo("failed");
        }
      },
      // no position (computer location services off, no Wi-Fi) or too slow: say so, never a silent "off"
      (e) => setGeo(e.code === e.PERMISSION_DENIED ? "denied" : "failed"),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- Read device permissions after hydration; these capabilities are owned by the browser. */
  useEffect(() => {
    if (!enforce) return;
    setMounted(true);
    const uaMobile = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile;
    setPhone(computerOk || uaMobile === true || isMobileDevice(navigator.userAgent));
    setIos(isIos());
    setInstalled(!isIos() || isStandalone());
    // notifications: subscribed on this device (and saved on the server again, in case it was lost)
    if (!publicKey) setPush("nokey");
    else if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) setPush("unsupported");
    else if (Notification.permission === "denied") setPush("denied");
    else
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => reg.pushManager.getSubscription())
        .then(async (sub) => {
          if (sub) {
            const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
            await savePush({ endpoint: j.endpoint, keys: j.keys });
          }
          setPush(sub ? "on" : "off");
        })
        .catch(() => setPush("unsupported"));
    // location: already allowed → send a fresh position (the server needs one from the last 15 min)
    if (!("geolocation" in navigator)) setGeo("unsupported");
    else if (navigator.permissions?.query)
      navigator.permissions
        .query({ name: "geolocation" as PermissionName })
        .then((s) => {
          if (s.state === "granted") sendPosition();
          else setGeo(s.state === "denied" ? "denied" : "off");
        })
        .catch(() => setGeo("off"));
    else setGeo("off");
  }, [enforce, computerOk, publicKey, sendPosition]);
  useEffect(() => {
    if (!checked && push !== "loading" && geo !== "loading") setChecked(true);
  }, [checked, push, geo]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function turnOnPush() {
    setPush("loading");
    try {
      if ((await Notification.requestPermission()) !== "granted") return setPush("denied");
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey as string) }));
      const j = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await savePush({ endpoint: j.endpoint, keys: j.keys });
      setPush("on");
    } catch {
      setPush("failed");
    }
  }

  if (!enforce) return <>{children}</>;
  // the placeholder only before the first check: a step being retried shows "checking…" in place
  if (!mounted || (!checked && (push === "loading" || geo === "loading"))) return <div aria-busy className="min-h-24 rounded-card bg-fill" />;
  const ready = phone && installed && push === "on" && geo === "on";
  const retry = (s: Perm) => s === "off" || s === "failed";
  if (ready) return <>{children}</>;

  const step = (icon: ReactNode, title: string, body: string, done: boolean, action: ReactNode) => (
    <li className="flex items-start gap-3 py-3">
      <span
        aria-hidden
        className={`flex h-10 w-10 flex-none items-center justify-center rounded-full ${done ? "bg-held-bg text-held" : "bg-brand-bg text-brand-ink"}`}
      >
        {done ? "✓" : icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body font-semibold">{title}</span>
        <span className="block text-meta leading-snug text-ink-2">{body}</span>
        {!done && action && <span className="mt-2 block">{action}</span>}
      </span>
    </li>
  );

  return (
    <section
      aria-labelledby="ready-title"
      className="flex max-h-[70vh] flex-col overflow-y-auto rounded-card border-2 border-brand bg-bg p-4 text-left shadow-card"
    >
      <h2 id="ready-title" className="text-title font-bold">
        {t("workReady.title")}
      </h2>
      <p className="text-small text-ink-2">{t("workReady.sub")}</p>
      <ol className="flex flex-col divide-y divide-line">
        {step(<Smartphone size={18} />, t("workReady.phone"), phone ? t(computerOk ? "workReady.computerOk" : "workReady.phoneOk") : t("workReady.phoneBody"), phone, null)}
        {phone &&
          ios &&
          step(
            <Share size={18} />,
            t("workReady.install"),
            installed ? t("workReady.installOk") : t("workReady.installBody"),
            installed,
            null,
          )}
        {step(
          <Bell size={18} />,
          t("workReady.notifications"),
          push === "denied"
            ? t(ios ? "workReady.notifDeniedIos" : "workReady.notifDenied")
            : push === "nokey"
              ? t("workReady.notifNoKey")
              : push === "unsupported"
                ? t(ios && !installed ? "workReady.notifAfterInstall" : "workReady.notifUnsupported")
                : push === "failed"
                  ? t("workReady.notifFailed")
                  : push === "loading"
                    ? t("workReady.checking")
                    : t("workReady.notifBody"),
          push === "on",
          (retry(push) || push === "loading") && phone && installed ? (
            <button type="button" onClick={turnOnPush} disabled={push === "loading"} className={`${btn.primary} w-full`}>
              {push === "loading" ? t("workReady.checking") : t("workReady.notifGo")}
            </button>
          ) : null,
        )}
        {step(
          <MapPin size={18} />,
          t("workReady.location"),
          geo === "denied"
            ? t(ios ? "workReady.geoDeniedIos" : "workReady.geoDenied")
            : geo === "unsupported"
              ? t("workReady.geoUnsupported")
              : geo === "failed"
                ? t(computerOk ? "workReady.geoFailedComputer" : "workReady.geoFailed")
                : geo === "loading"
                  ? t("workReady.checking")
                  : t("workReady.geoBody"),
          geo === "on",
          (retry(geo) || geo === "loading") && phone ? (
            <button type="button" onClick={sendPosition} disabled={geo === "loading"} className={`${btn.primary} w-full`}>
              {geo === "loading" ? t("workReady.checking") : t("workReady.geoGo")}
            </button>
          ) : null,
        )}
      </ol>
    </section>
  );
}
