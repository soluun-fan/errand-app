"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useT } from "@/i18n/client";
import { chipClass } from "@/components/ui";
import { DRAFT_KEY } from "@/lib/draft";

/** "Үргэлжлүүлэх: Угаалгын машин зөөх →" when an unfinished post is saved on this device (ref 06). */
export function DraftChip() {
  const t = useT();
  const [title, setTitle] = useState<string | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      const d = raw ? (JSON.parse(raw) as { title?: string }) : null;
      if (d?.title?.trim()) setTitle(d.title.trim());
    } catch {
      /* no storage */
    }
  }, []);
  if (!title) return null;
  return (
    <Link href="/post?resume=1" className={chipClass(true)}>
      ↻ {t("home.continueDraft", { title })} →
    </Link>
  );
}
