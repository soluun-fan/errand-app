import type { T } from "@/i18n";
import type { DealStatus } from "@/lib/engine/types";
import { STATUS_TONE, TONE_CLASS } from "@/lib/labels";

const DOT: Record<string, string> = {
  held: "bg-held",
  warn: "bg-warn",
  bad: "bg-danger",
  info: "bg-ink",
  grey: "bg-ink-3",
};

/** Colour + dot + words: status is never shown by colour alone (UI-FLOWS §14). */
/** `helper`: the words from the helper's side ("the customer is checking", not "check the job"). */
export function StatusBadge({ status, t, helper = false }: { status: DealStatus; t: T; helper?: boolean }) {
  const tone = STATUS_TONE[status];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-caption font-semibold ${TONE_CLASS[tone]}`}>
      <span aria-hidden className={`h-2 w-2 rounded-full ${DOT[tone]}`} />
      {helper && status === "check" ? t("statusHelper.check") : t(`status.${status}`)}
    </span>
  );
}
