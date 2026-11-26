"use client";

import { ChevronsRight, LoaderCircle } from "lucide-react";
import { useRef, useState, type PointerEvent } from "react";
import { useFormStatus } from "react-dom";

const THUMB = 56; // px, the round handle
const DONE_AT = 0.85; // share of the track that counts as "slid"

/**
 * "Slide to finish" (PleaseHelp-style): a submit control for actions that must not happen by an
 * accidental tap — a pocket, a hurried thumb. Dragging the handle to the end submits the form; a
 * plain tap only nudges the handle. The handle is a real submit button, so the keyboard (Enter /
 * Space) and screen readers still work. The form's own validation (e.g. a required code) runs first.
 */
export function SlideSubmit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  const track = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const start = useRef<number | null>(null);
  const slid = useRef(false);
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);

  const max = () => Math.max(0, (track.current?.clientWidth ?? 0) - THUMB - 8);

  const onDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (pending) return;
    start.current = e.clientX - x;
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (start.current === null) return;
    setX(Math.min(max(), Math.max(0, e.clientX - start.current)));
  };
  const onUp = () => {
    if (start.current === null) return;
    start.current = null;
    setDragging(false);
    if (max() > 0 && x >= max() * DONE_AT) {
      setX(max());
      slid.current = true;
      button.current?.form?.requestSubmit(button.current);
      // a form that didn't submit (validation failed) lets the handle go back
      setTimeout(() => {
        slid.current = false;
        if (!button.current?.form?.checkValidity()) setX(0);
      }, 50);
    } else setX(0);
  };

  return (
    <div ref={track} className="relative flex h-16 select-none items-center overflow-hidden rounded-cta bg-brand-bg p-1">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center justify-center pl-12 text-lead font-bold text-brand-ink"
      >
        {label}
      </span>
      <button
        ref={button}
        type="submit"
        aria-label={label}
        disabled={pending}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        // a real pointer tap (detail ≥ 1) doesn't submit — only a slide or the keyboard (detail 0) does
        onClick={(e) => {
          if (e.detail > 0 && !slid.current) e.preventDefault();
        }}
        style={{ transform: `translateX(${x}px)`, touchAction: "none" }}
        className={`relative flex h-14 w-14 flex-none items-center justify-center rounded-full bg-brand text-white shadow-float ${dragging ? "" : "transition-transform duration-200"}`}
      >
        {pending ? <LoaderCircle aria-hidden size={24} className="animate-spin" /> : <ChevronsRight aria-hidden size={26} />}
      </button>
    </div>
  );
}
