"use client";

import { useState } from "react";
import { useT } from "@/i18n/client";

/** Small "Copy" link (e.g. an address to paste into a taxi or map app). Says "Copied" for 2 s. */
export function CopyButton({ text, label }: { text: string; label?: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    } catch {
      /* clipboard blocked: the text is on screen to select by hand */
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={label ? `${t("common.copy")}: ${label}` : t("common.copy")}
      className="min-h-11 flex-none px-2 text-[15px] font-semibold text-brand-ink underline underline-offset-4"
    >
      <span aria-live="polite">{done ? `✓ ${t("common.copied")}` : t("common.copy")}</span>
    </button>
  );
}
