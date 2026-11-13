"use client";

import { useActionState, type ReactNode } from "react";
import { SubmitButton, type ActionResult, type FormAction } from "./sheet";

/** A form that runs a server action in one tap (no confirm sheet) and shows its error inline. */
export function InlineAction({
  action,
  fields,
  label,
  className,
  children,
  done,
}: {
  action: FormAction;
  fields: Record<string, string>;
  label: string;
  className: string;
  /** Extra inputs above the button (e.g. a quote price). */
  children?: ReactNode;
  /** Shown instead of the form once the action succeeded. */
  done?: ReactNode;
}) {
  const [state, formAction] = useActionState<ActionResult, FormData>(action, {});
  if (state.done && done) return <>{done}</>;
  return (
    <form action={formAction} className="flex flex-col gap-3">
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {children}
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      <SubmitButton className={className}>{label}</SubmitButton>
    </form>
  );
}
