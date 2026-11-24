"use client";

import { useEffect } from "react";
import { reportClientError } from "@/app/report-error";
import { EmptyState, btn } from "@/components/ui";
import { useT } from "@/i18n/client";
import { TriangleAlert } from "lucide-react";

/** Plain message + retry; reassures that money didn't move (UI-FLOWS §0.9). */
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  const t = useT();
  // the error screen was shown: tell Ops (server errors arrive by themselves; this catches browser ones)
  useEffect(() => {
    const e = error as { message?: string; stack?: string; digest?: string } | null;
    if (e?.digest) return; // a server error — already in the log
    void reportClientError(e?.message ?? String(error), e?.stack ?? null, location.pathname).catch(() => undefined);
  }, [error]);
  return (
    <EmptyState
      icon={<TriangleAlert aria-hidden size={28} />}
      title={t("common.errorTitle")}
      body={t("common.errorBody")}
      action={
        <button className={btn.primary} onClick={() => retry()}>
          {t("common.retry")}
        </button>
      }
    />
  );
}
