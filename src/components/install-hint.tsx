"use client";

import { Download, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "@/i18n/client";
import { btn } from "./ui";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
const DISMISSED = "install-hint-dismissed";

/**
 * "Add the app to your home screen" (2026-11-22). Android/Chrome: the browser's own install prompt.
 * iPhone: Safari has no prompt, so show the two steps (Share → Add to Home Screen) — on iOS,
 * notifications only work for installed apps. Hidden once installed or dismissed on this device.
 */
export function InstallHint() {
  const t = useT();
  const [kind, setKind] = useState<"hidden" | "prompt" | "ios">("hidden");
  const [evt, setEvt] = useState<InstallEvent | null>(null);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone || localStorage.getItem(DISMISSED)) return;
    const ua = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
    if (ios) setKind("ios");
    const onPrompt = (e: Event) => { e.preventDefault(); setEvt(e as InstallEvent); setKind("prompt"); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const dismiss = () => { localStorage.setItem(DISMISSED, "1"); setKind("hidden"); };
  async function install() {
    if (!evt) return;
    await evt.prompt();
    await evt.userChoice.catch(() => undefined);
    setKind("hidden");
  }

  if (kind === "hidden") return null;
  return (
    <section className="flex items-start gap-3 rounded-card bg-bg p-3 shadow-card">
      <span aria-hidden className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-brand-bg text-brand-ink">
        <Download size={18} />
      </span>
      <div className="flex flex-1 flex-col gap-1">
        <p className="font-semibold">{t("install.title")}</p>
        <p className="text-sm text-ink-2">{t(kind === "ios" ? "install.ios" : "install.body")}</p>
        {kind === "prompt" && <button type="button" className={btn.secondary} onClick={() => void install()}>{t("install.go")}</button>}
      </div>
      <button type="button" aria-label={t("install.dismiss")} className="flex h-11 w-11 items-center justify-center text-ink-3" onClick={dismiss}>
        <X size={18} />
      </button>
    </section>
  );
}
