"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CategoryIcon } from "@/components/category-icon";
import { btn } from "@/components/ui";
import { useT } from "@/i18n/client";
import type { CategoryId } from "@/lib/engine";
import { addWorkKinds } from "../profile/actions";

const KEY = "tuslamj.newKindsDismissed";

/**
 * Everyday kinds the helper hasn't picked (new ones appear over time): tasks of those kinds don't
 * reach them. One tap adds them all; ✕ hides the card until another new kind appears.
 */
export function NewKindsCard({ missing, userId }: { missing: CategoryId[]; userId: string }) {
  const t = useT();
  const sig = [...missing].sort().join(",");
  const storageKey = `${KEY}:${userId}`;
  const [hidden, setHidden] = useState(true); // decided after reading the browser's memory
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    try {
      setHidden(localStorage.getItem(storageKey) === sig);
    } catch {
      setHidden(false);
    }
  }, [sig, storageKey]);
  if (hidden || !missing.length) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(storageKey, sig);
    } catch {
      /* private mode: hide for this visit only */
    }
    setHidden(true);
  };

  return (
    <section className="relative flex flex-col gap-3 rounded-card bg-brand-bg p-4" aria-label={t("workKinds.newTitle")}>
      <button type="button" onClick={dismiss} aria-label={t("common.close")} className="absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-full text-ink-2">
        <X size={18} />
      </button>
      <div className="pr-8">
        <p className="font-bold">{t("workKinds.newTitle")}</p>
        <p className="text-sm text-ink-2">{t("workKinds.newBody")}</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {missing.map((c) => (
          <span key={c} className="inline-flex min-h-8 items-center gap-1 rounded-full bg-bg px-3 text-[13px] font-semibold">
            <CategoryIcon id={c} size={14} /> {t(`categoryShort.${c}`)}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(undefined);
            try {
              const result = await addWorkKinds(missing);
              if (result.error) setError(result.error);
            } catch {
              setError(t("error.generic"));
            } finally {
              setBusy(false);
            }
          }}
          className={btn.small}
        >
          {busy ? t("common.working") : t("workKinds.addAll")}
        </button>
        <Link href="/profile" className="text-[14px] font-semibold text-brand-ink underline underline-offset-4">
          {t("workKinds.choose")}
        </Link>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </section>
  );
}
