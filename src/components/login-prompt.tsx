"use client";

import { ArrowRight, LockKeyhole, Search, X } from "lucide-react";
import Link from "next/link";
import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { btn, hero } from "@/components/ui";
import { useT } from "@/i18n/client";

/**
 * Logged-out visitors can look around; only acting needs a login. Instead of throwing them onto
 * the login page, a small sheet explains it and returns them to what they started afterwards
 * (`/login?next=…`, checked by `safeNext`).
 */
const Ctx = createContext<(next: string) => void>(() => {});

/** One shared login sheet for the whole page; `LoginGate` / `LandingSearch` open it. */
export function LoginPromptProvider({ children }: { children: ReactNode }) {
  const { open, dialog } = useLoginSheet();
  return (
    <Ctx.Provider value={open}>
      {children}
      {dialog}
    </Ctx.Provider>
  );
}

function useLoginSheet() {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const [next, setNext] = useState("/");
  const open = (to: string) => {
    setNext(to);
    ref.current?.showModal();
  };
  const close = () => ref.current?.close();
  const dialog = (
    <dialog
      ref={ref}
      aria-labelledby="login-gate-title"
      onClick={(e) => e.target === ref.current && close()}
      className="relative mx-auto mb-0 mt-auto max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-sheet bg-bg p-0 text-ink shadow-float sm:mb-auto sm:rounded-sheet"
    >
      <div className="flex flex-col items-center gap-3 px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-7 text-center">
        <button type="button" onClick={close} aria-label={t("common.close")} className="absolute right-2 top-2 flex h-12 w-12 items-center justify-center rounded-full text-ink-2 hover:bg-fill">
          <X aria-hidden size={20} />
        </button>
        <span aria-hidden className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-bg text-brand-ink">
          <LockKeyhole size={28} />
        </span>
        <h2 id="login-gate-title" className="text-[20px] font-bold">
          {t("landing.gateTitle")}
        </h2>
        <p className="text-[15px] text-ink-2">{t("landing.gateBody")}</p>
        <Link href={`/login?next=${encodeURIComponent(next)}`} className={`${btn.primary} mt-2 w-full`}>
          {t("landing.gateGo")}
        </Link>
        <button type="button" onClick={close} className={`${btn.text} w-full`}>
          {t("landing.gateLater")}
        </button>
        <p className="text-[13px] text-ink-2">{t("landing.gateNote")}</p>
      </div>
    </dialog>
  );
  return { open, dialog };
}

/** A button that opens the login sheet, then continues to `next` after login. */
export function LoginGate({ next, className, children, label }: { next: string; className: string; children: ReactNode; label?: string }) {
  const open = useContext(Ctx);
  return (
    <button type="button" aria-label={label} onClick={() => open(next)} className={className}>
      {children}
    </button>
  );
}

/** The landing page's big search box: whatever they type becomes the task title after login. */
export function LandingSearch() {
  const t = useT();
  const open = useContext(Ctx);
  const [q, setQ] = useState("");
  return (
    <form
        onSubmit={(e) => {
          e.preventDefault();
          open(q.trim() ? `/post?title=${encodeURIComponent(q.trim().slice(0, 60))}` : "/post");
        }}
        className={hero.search}
      >
        <Search aria-hidden size={20} className="flex-none text-ink-2" />
        <label htmlFor="landing-q" className="sr-only">
          {t("landing.searchPh")}
        </label>
        <input
          id="landing-q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={60}
          placeholder={t("landing.searchPh")}
          className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-ink-3"
        />
        <button aria-label={t("landing.searchGo")} className={hero.searchGo}>
          <span className="hidden sm:inline">{t("landing.searchGo")}</span>
          <ArrowRight aria-hidden size={20} className="sm:hidden" />
        </button>
    </form>
  );
}
