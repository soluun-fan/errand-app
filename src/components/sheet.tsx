"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
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
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // backdrop
      }}
      className="mx-auto mb-0 mt-auto w-full max-w-lg rounded-t-sheet bg-bg p-0 text-ink shadow-float sm:mb-auto sm:rounded-sheet"
    >
      <div className="flex max-h-[85vh] flex-col gap-4 overflow-y-auto p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
        <div aria-hidden className="mx-auto -mt-2 h-1 w-10 rounded-full bg-line" />
        <h2 className="text-center text-xl font-semibold">{title}</h2>
        {children}
      </div>
    </dialog>
  );
}

/** Disables itself while its form is submitting (double-tap protection, UI-FLOWS §14). */
export function SubmitButton({ className, children, pendingLabel }: { className: string; children: ReactNode; pendingLabel?: string }) {
  const { pending } = useFormStatus();
  const t = useT();
  return (
    <button className={className} disabled={pending} aria-busy={pending}>
      {pending ? (pendingLabel ?? t("common.working")) : children}
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
          {body && <div className="text-[16px] text-ink">{body}</div>}
          {children}
          {state.error && (
            <p role="alert" className="text-sm text-danger">
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
