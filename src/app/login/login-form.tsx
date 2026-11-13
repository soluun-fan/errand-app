"use client";

import { useActionState } from "react";
import { formatMnPhone } from "@/lib/phone";
import { login, type LoginState } from "./actions";

const initial: LoginState = { step: "phone" };

const input =
  "h-12 w-full rounded-xl border border-zinc-300 bg-white px-4 text-base text-zinc-900 outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-700/20";
const primary =
  "h-12 w-full rounded-xl bg-zinc-900 font-semibold text-white disabled:opacity-50";

export function LoginForm({ showDemoHint }: { showDemoHint: boolean }) {
  const [state, action, pending] = useActionState(login, initial);

  if (state.step === "code") {
    return (
      <form action={action} className="flex flex-col gap-4">
        <p className="text-sm text-zinc-600">
          We sent a 6-digit code to <b className="text-zinc-900">{formatMnPhone(state.phone)}</b>.
        </p>
        {state.devCode && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Development mode — no SMS was sent. Your code is{" "}
            <b className="font-mono tracking-widest">{state.devCode}</b>
          </p>
        )}
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          Code
          <input
            name="code"
            className={`${input} tracking-[0.4em]`}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            autoFocus
          />
        </label>
        {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
        <button className={primary} disabled={pending}>
          {pending ? "Checking…" : "Sign in"}
        </button>
        <button name="intent" value="change-number" formNoValidate className="h-11 text-sm font-medium text-zinc-600 underline">
          Use a different number
        </button>
      </form>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Mobile number
        <div className="flex items-center gap-2">
          <span className="text-base font-normal text-zinc-500">+976</span>
          <input
            name="phone"
            className={input}
            inputMode="tel"
            autoComplete="tel-national"
            placeholder="8800 0001"
            defaultValue={state.phoneInput}
            required
            autoFocus
          />
        </div>
      </label>
      {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      <button className={primary} disabled={pending}>
        {pending ? "Sending…" : "Send code"}
      </button>
      {showDemoHint && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          Development mode: any number works and the code is shown on the next screen. Demo accounts
          (after <code>npm run seed</code>): 8800 0001 customer, 8800 0011 helper, 8800 0099 Ops.
        </p>
      )}
    </form>
  );
}
