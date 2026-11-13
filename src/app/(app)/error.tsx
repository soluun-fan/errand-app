"use client";

import { EmptyState, btn } from "@/components/ui";
import { useT } from "@/i18n/client";

/** Plain message + retry; reassures that money didn't move (UI-FLOWS §0.9). */
export default function AppError({ retry }: { error: unknown; retry: () => void }) {
  const t = useT();
  return (
    <EmptyState
      icon="⚠️"
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
