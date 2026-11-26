"use client";

import { Bookmark, BriefcaseBusiness, Check, ChevronDown, Clock3, House, MapPin, X } from "lucide-react";
import { useId, useState } from "react";
import { useT } from "@/i18n/client";
import { PinMap, type Pin, type PinKind } from "./pin-map";
import { btn } from "./ui";

export interface AddressChoice {
  id: string;
  label: string;
  address: string;
  kind: "home" | "work" | "other" | "recent";
}
const icons = { home: House, work: BriefcaseBusiness, other: Bookmark, recent: Clock3 };

/** Text, saved places and an optional map pin stay together for the SAME end of the trip. */
export function AddressInput({
  label,
  hint,
  placeholder,
  value,
  pin,
  kind = "drop",
  other,
  optional = false,
  rail = false,
  choices,
  onChange,
  onChoose,
  onPinChange,
}: {
  label: string;
  hint: string;
  placeholder: string;
  value: string;
  pin: Pin | null;
  kind?: PinKind;
  other?: (Pin & { kind: PinKind }) | null;
  optional?: boolean;
  /** inside a RouteStops card: no card of its own, and the stop icon comes from the route line */
  rail?: boolean;
  choices: AddressChoice[];
  onChange: (value: string) => void;
  onChoose: (choice: AddressChoice) => void;
  onPinChange: (pin: Pin | null) => void;
}) {
  const t = useT();
  const id = useId();
  const [pendingPin, setPendingPin] = useState<Pin | null>(null);
  const [showChoices, setShowChoices] = useState(false);
  const [allChoices, setAllChoices] = useState(false);
  const query = value.trim().toLocaleLowerCase();
  const matches = choices.filter((a) => allChoices || !query || `${a.label} ${a.address}`.toLocaleLowerCase().includes(query));
  return (
    <section className={rail ? "" : "rounded-card bg-bg p-4 shadow-card"} aria-labelledby={`${id}-label`}>
      <div className={`mb-3 flex items-center gap-2 ${rail ? "min-h-8" : ""}`}>
        {!rail && (
          <span
            aria-hidden
            className={`flex h-7 w-7 items-center justify-center rounded-full ${kind === "pickup" ? "bg-ink text-white" : "bg-brand-bg text-brand-ink"}`}
          >
            <MapPin size={15} />
          </span>
        )}
        <label id={`${id}-label`} htmlFor={`${id}-address`} className="flex-1 text-[16px] font-bold">
          {label}
        </label>
        {optional && <span className="text-xs text-ink-2">{t("addressEntry.optional")}</span>}
      </div>
      <input
        id={`${id}-address`}
        type="text"
        autoComplete="off"
        value={value}
        maxLength={200}
        placeholder={placeholder}
        aria-describedby={`${id}-hint`}
        onFocus={() => {
          setShowChoices(true);
          setAllChoices(false);
        }}
        onChange={(e) => {
          setPendingPin(null);
          onChange(e.target.value);
          setShowChoices(true);
          setAllChoices(false);
        }}
        className="min-h-12 w-full min-w-0 rounded-input border border-line bg-canvas/60 px-3 text-[16px] outline-none placeholder:text-ink-3 focus:border-brand focus:ring-2 focus:ring-brand/15"
      />
      <p id={`${id}-hint`} className="mt-2 text-[13px] leading-relaxed text-ink-2">
        {hint}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-4">
        {choices.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setShowChoices(!showChoices || !allChoices);
              setAllChoices(true);
            }}
            aria-label={t("addressEntry.saved")}
            aria-expanded={showChoices && matches.length > 0}
            aria-controls={`${id}-choices`}
            className="flex min-h-11 items-center gap-1.5 text-[13px] font-medium text-ink-2"
          >
            <Bookmark aria-hidden size={15} />
            {t("addressEntry.savedShort")}
            <ChevronDown aria-hidden size={14} />
          </button>
        )}
        {pin && (
          <button
            type="button"
            onClick={() => {
              setPendingPin(null);
              onPinChange(null);
            }}
            className="min-h-11 text-[13px] text-ink-2 underline underline-offset-2"
          >
            {t("addressEntry.clearPin")}
          </button>
        )}
      </div>
      {showChoices && matches.length > 0 && (
        <div id={`${id}-choices`} className="mt-1 border-t border-line pt-2">
          <div className="flex items-center justify-between text-xs font-semibold text-ink-2">
            {t("addressEntry.saved")}
            <button
              type="button"
              aria-label={t("common.close")}
              onClick={() => setShowChoices(false)}
              className="flex h-11 w-11 items-center justify-center"
            >
              <X size={16} />
            </button>
          </div>
          <ul className="max-h-56 overflow-y-auto">
            {matches.map((choice) => {
              const Icon = icons[choice.kind];
              return (
                <li key={choice.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setPendingPin(null);
                      onChoose(choice);
                      setShowChoices(false);
                    }}
                    className="flex min-h-14 w-full items-center gap-3 rounded-input px-2 py-2.5 text-left hover:bg-fill focus-visible:bg-fill"
                  >
                    <Icon aria-hidden size={18} className="flex-none text-ink-2" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-semibold">{choice.label}</span>
                      {choice.label !== choice.address && <span className="block truncate text-[13px] text-ink-2">{choice.address}</span>}
                    </span>
                    {choice.address === value && <Check aria-hidden size={16} className="flex-none text-brand-ink" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <div className="mt-2 space-y-2">
        <PinMap value={pendingPin ?? pin} kind={kind} other={other} start={other} onChange={setPendingPin} height={220} />
        <p className="text-[13px] text-ink-2">{t("addressEntry.pinHelp")}</p>
        {pendingPin && (pendingPin.lat !== pin?.lat || pendingPin.lng !== pin?.lng) ? (
          <button
            type="button"
            className={btn.secondary}
            onClick={() => {
              onPinChange(pendingPin);
              setPendingPin(null);
            }}
          >
            {t("addressEntry.usePin")}
          </button>
        ) : (
          pin && (
            <span className="flex items-center gap-1 text-sm text-brand-ink">
              <Check size={15} />
              {t("addressEntry.pinConfirmed")}
            </span>
          )
        )}
      </div>
    </section>
  );
}
