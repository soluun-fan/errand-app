"use client";

import { useActionState, useRef, type ReactNode } from "react";
import { SubmitButton, keepEntries, type ActionResult, type FormAction } from "./sheet";
import { SlideSubmit } from "./slide-submit";

/** A form that runs a server action in one tap (no confirm sheet) and shows its error inline. */
export function InlineAction({
  action,
  fields,
  label,
  className,
  children,
  done,
  slide,
}: {
  /** Slide to submit instead of a tap — for steps that must not happen by accident (finishing a job). */
  slide?: boolean;
  action: FormAction;
  fields: Record<string, string>;
  label: string;
  className: string;
  /** Extra inputs above the button (e.g. a quote price). */
  children?: ReactNode;
  /** Shown instead of the form once the action succeeded. */
  done?: ReactNode;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(async (prev, data) => {
    const r = await action(prev, data);
    if (r.done) form.current?.reset(); // entries stay after an error, clear after success
    return r;
  }, {});
  if (state.done && done) return <>{done}</>;
  return (
    // the slide control follows the form's own status, so it keeps the native submit
    <form ref={form} {...(slide ? { action: formAction } : { onSubmit: keepEntries(formAction) })} className="flex flex-col gap-3">
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {children}
      {state.error && (
        <p role="alert" className="text-small text-danger">
          {state.error}
        </p>
      )}
      {slide ? (
        <SlideSubmit label={label} />
      ) : (
        <SubmitButton className={className} busy={pending}>
          {label}
        </SubmitButton>
      )}
    </form>
  );
}
