"use client";

import { useActionState, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { X } from "lucide-react";
import { useT } from "@/i18n/client";
import { btn } from "./ui";

/** Native <dialog> as a bottom sheet on phones, centered card on wider screens. Esc and backdrop close it. */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const t = useT();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- backdrop tap only; a native <dialog> already closes with Escape
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // backdrop
      }}
      className="mx-auto mb-0 mt-auto w-full max-w-lg rounded-t-sheet bg-bg p-0 text-ink shadow-float sm:mb-auto sm:rounded-sheet"
    >
      <div className="flex max-h-[85dvh] flex-col gap-4 overflow-y-auto p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
        <div aria-hidden className="mx-auto -mt-2 h-1 w-10 rounded-full bg-line" />
        <div className="grid grid-cols-[minmax(0,1fr)_48px] items-start gap-2">
          <h2 className="min-w-0 py-2 text-title-lg font-semibold leading-snug">{title}</h2>
          <button type="button" onClick={onClose} aria-label={t("common.close")} className="flex h-12 w-12 items-center justify-center rounded-full text-ink-2 hover:bg-fill">
            <X aria-hidden size={20} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

/** Disables itself while its form is submitting (double-tap protection, UI-FLOWS §14). */
/** `pendingContent` replaces the "Working…" text (e.g. a spinner in an icon-only button); other button attributes (aria-label, aria-pressed, title) pass through. */
export function SubmitButton({
  className,
  children,
  pendingLabel,
  pendingContent,
  disabled = false,
  ...rest
}: { className: string; children: ReactNode; pendingLabel?: string; pendingContent?: ReactNode; disabled?: boolean } & Pick<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-label" | "aria-pressed" | "title"
>) {
  const { pending } = useFormStatus();
  const t = useT();
  return (
    <button {...rest} className={className} disabled={pending || disabled} aria-busy={pending}>
      {pending ? (pendingContent ?? pendingLabel ?? t("common.working")) : children}
    </button>
  );
}

export interface ActionResult {
  error?: string;
  done?: boolean;
}
export type FormAction = (prev: ActionResult, form: FormData) => Promise<ActionResult>;

/**
 * Trigger button → sheet that states the exact consequence → confirm runs the server action.
 * Used for everything that moves money (UI-FLOWS §0.10).
 */
export function ConfirmSheet({
  action,
  fields,
  trigger,
  triggerClass,
  title,
  body,
  confirmLabel,
  confirmClass = btn.primary,
  children,
}: {
  action: FormAction;
  fields: Record<string, string>;
  trigger: ReactNode;
  triggerClass: string;
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  confirmClass?: string;
  /** Extra form inputs shown in the sheet (e.g. dispute reasons). */
  children?: ReactNode;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<ActionResult, FormData>(async (prev, form) => {
    const r = await action(prev, form);
    if (r.done) setOpen(false);
    return r;
  }, {});

  return (
    <>
      <button type="button" className={triggerClass} onClick={() => setOpen(true)}>
        {trigger}
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title={title}>
        <form action={formAction} className="flex flex-col gap-4">
          {Object.entries(fields).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          {body && <div className="text-lead text-ink">{body}</div>}
          {children}
          {state.error && (
            <p role="alert" className="text-small text-danger">
              {state.error}
            </p>
          )}
          <div className="flex flex-col gap-2">
            <SubmitButton className={`${confirmClass} w-full`}>{confirmLabel}</SubmitButton>
            <button type="button" className={`${btn.text} w-full`} onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </button>
          </div>
        </form>
      </BottomSheet>
    </>
  );
}
