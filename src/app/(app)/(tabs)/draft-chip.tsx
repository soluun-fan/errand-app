"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useT } from "@/i18n/client";
import { chipClass } from "@/components/ui";
import { draftKeyFor } from "@/lib/draft";
import { titleFromBrief } from "@/lib/task-brief";

/** "Үргэлжлүүлэх: Угаалгын машин зөөх →" when an unfinished post is saved on this device (ref 06). */
export function DraftChip({ userId }: { userId: string }) {
  const t = useT();
  const [title, setTitle] = useState<string | null>(null);
  /* eslint-disable react-hooks/set-state-in-effect -- Read the saved draft after hydration; localStorage is unavailable on the server. */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKeyFor(userId));
      const d = raw ? (JSON.parse(raw) as { title?: string; description?: string }) : null;
      const label = d?.title?.trim() || titleFromBrief(d?.description ?? "", 40);
      if (label) setTitle(label);
    } catch {
      /* no storage */
    }
  }, [userId]);
  /* eslint-enable react-hooks/set-state-in-effect */
  if (!title) return null;
  return (
    <Link href="/post?resume=1" className={chipClass(true)}>
      ↻ {t("home.continueDraft", { title })} →
    </Link>
  );
}
