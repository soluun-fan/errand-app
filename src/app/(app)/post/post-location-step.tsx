"use client";

import { AddressInput, type AddressChoice } from "@/components/address-input";
import { DashedAdd, ToggleRow } from "@/components/choice";
import { RouteStops } from "@/components/detail";
import { Ico } from "@/components/icon";
import { chipClass, field, fieldLabel } from "@/components/ui";
import { useT } from "@/i18n/client";
import type { SavedAddress } from "@/lib/addresses";

import { Check, DoorClosed, Plus } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { CONTACTLESS_KINDS, KIND_ICON, digits, fromSaved, twoPlaces, type Draft } from "./post-draft";

/** Floor as typed, digits only and at most 60 (the engine refuses more). */
const floorInput = (raw: string) => {
  const v = digits(raw);
  return v === "" ? "" : String(Math.min(60, Number(v)));
};
const NOTE_MAX = 300;
const NOTE_CHIPS = ["door", "guard", "callFirst", "codeInChat"] as const;

export function PostLocationStep({
  d,
  setD,
  saved,
  recent,
  arrivalSummary,
}: {
  d: Draft;
  setD: Dispatch<SetStateAction<Draft>>;
  saved: SavedAddress[];
  recent: string[];
  arrivalSummary: string;
}) {
  const t = useT();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const twoPoint = twoPlaces(d);
  const isCarry = d.category === "carry";
  const savedMatch = saved.find((a) => a.address === d.address.trim());
  const savedName = (a: SavedAddress) => (a.kind === "other" ? (a.label ?? a.address) : t(`task.saved.${a.kind}`));
  const addressChoices: AddressChoice[] = [
    ...saved.map((a) => ({ id: a.id, label: savedName(a), address: a.address, kind: a.kind })),
    ...recent.map((address, i) => ({ id: `recent-${i}`, label: address, address, kind: "recent" as const })),
  ];
  const chooseAddress = (choice: AddressChoice, pickup = false) => {
    const a = saved.find((s) => s.id === choice.id);
    if (pickup) {
      setD((x) => ({ ...x, pickup: choice.address, pickupPin: a?.lat != null && a.lng != null ? { lat: a.lat, lng: a.lng } : null }));
    } else {
      setD((x) => ({
        ...x,
        ...(a
          ? fromSaved(a)
          : {
              address: choice.address,
              pin: null,
              entrance: "",
              floor: "",
              unit: "",
              lift: null,
              note: "",
              saveAs: "" as const,
              showDetails: false,
            }),
      }));
    }
  };
  const dropInput = (
    <AddressInput
      rail={twoPoint}
      label={twoPoint ? t("task.drop") : t("task.where")}
      hint={t("addressEntry.destinationHelp")}
      placeholder={t("addressEntry.destinationExample")}
      value={d.address}
      pin={d.pin}
      choices={addressChoices}
      other={twoPoint && d.pickupPin ? { ...d.pickupPin, kind: "pickup" } : null}
      onChange={(address) =>
        setD((x) => ({
          ...x,
          address,
          ...(address.trim() !== x.address.trim()
            ? { pin: null, entrance: "", floor: "", unit: "", lift: null, note: "", saveAs: "" }
            : {}),
        }))
      }
      onChoose={(choice) => chooseAddress(choice)}
      onPinChange={(pin) => set("pin", pin)}
    />
  );
  return (
    <>
      <p className="-mt-2 text-small leading-relaxed text-ink-2">{t("addressEntry.intro")}</p>
      {/* one place or pickup → drop-off: the customer decides; the kind only sets the usual (2026-11-26) */}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-body font-medium text-ink-2">{t("addressEntry.placesLabel")}</legend>
        <div className="grid grid-cols-2 gap-1 rounded-full bg-fill p-1" role="radiogroup" aria-label={t("addressEntry.placesLabel")}>
          {([1, 2] as const).map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={twoPoint === (n === 2)}
              onClick={() => setD((x) => ({ ...x, places: n, ...(n === 1 ? { roundTrip: false } : {}) }))}
              className={`min-h-11 rounded-full text-body font-semibold ${twoPoint === (n === 2) ? "bg-bg text-ink shadow-float" : "text-ink-2"}`}
            >
              {t(n === 1 ? "addressEntry.placesOne" : "addressEntry.placesTwo")}
            </button>
          ))}
        </div>
      </fieldset>
      {twoPoint ? (
        // pickup → drop-off as one route: two stops joined by a line
        <div className="rounded-card bg-bg p-4 shadow-card">
          <RouteStops
            stops={[
              {
                key: "pickup",
                kind: "pickup",
                children: (
                  <AddressInput
                    rail
                    label={t("task.pickup")}
                    hint={t("addressEntry.pickupHelp")}
                    placeholder={t("addressEntry.pickupExample")}
                    value={d.pickup}
                    pin={d.pickupPin}
                    kind="pickup"
                    optional
                    choices={addressChoices}
                    other={d.pin ? { ...d.pin, kind: "drop" } : null}
                    onChange={(pickup) =>
                      setD((x) => ({ ...x, pickup, pickupPin: pickup.trim() === x.pickup.trim() ? x.pickupPin : null }))
                    }
                    onChoose={(choice) => chooseAddress(choice, true)}
                    onPinChange={(pin) => set("pickupPin", pin)}
                  />
                ),
              },
              { key: "drop", kind: "drop", children: dropInput },
            ]}
          />
        </div>
      ) : (
        dropInput
      )}
      {d.showDetails || isCarry ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="font-semibold">{t("addressEntry.details")}</h2>
              <p className="text-small text-ink-2">{t("addressEntry.detailsHelp")}</p>
            </div>
            {!isCarry && (
              <button type="button" onClick={() => set("showDetails", false)} className="min-h-11 text-meta font-medium text-brand-ink">
                {t("addressEntry.hideDetails")}
              </button>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(["entrance", "floor", "unit"] as const).map((k) => (
              <label key={k} className={fieldLabel}>
                {t(`task.${k}`)}
                <input
                  className={field}
                  inputMode="numeric"
                  value={d[k]}
                  maxLength={k === "floor" ? 2 : 10}
                  // floors stop at 60 (the tallest UB buildings; the engine refuses more)
                  onChange={(e) => set(k, k === "floor" ? floorInput(e.target.value) : e.target.value)}
                  placeholder={k === "entrance" ? "1" : k === "floor" ? "5" : "54"}
                />
              </label>
            ))}
          </div>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-body font-medium text-ink-2">{t("task.lift")}</legend>
            <div className="grid grid-cols-3 gap-1 rounded-full bg-fill p-1" role="radiogroup">
              {(["yes", "no", "unknown"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={d.lift === v}
                  onClick={() => set("lift", v)}
                  className={`min-h-11 rounded-full text-body font-semibold ${d.lift === v ? "bg-bg text-ink shadow-float" : "text-ink-2"}`}
                >
                  {t(v === "yes" ? "task.liftYes" : v === "no" ? "task.liftNo" : "task.liftUnknown")}
                </button>
              ))}
            </div>
          </fieldset>
          {isCarry && d.lift === "unknown" && <p className="text-small text-ink-2">{t("task.liftUnknownNote")}</p>}
          {/* UB apartment yards: whether a car can stop by the entrance changes a carry job (2026-11-26) */}
          {isCarry && (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1.5 text-body font-medium text-ink-2">{t("task.parking")}</legend>
              <div className="grid grid-cols-3 gap-1 rounded-full bg-fill p-1" role="radiogroup">
                {(["yes", "no", "unknown"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={d.parking === v}
                    onClick={() => set("parking", v)}
                    className={`min-h-11 rounded-full text-body font-semibold ${d.parking === v ? "bg-bg text-ink shadow-float" : "text-ink-2"}`}
                  >
                    {t(v === "yes" ? "task.parkingYes" : v === "no" ? "task.parkingNo" : "task.liftUnknown")}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          <label className={fieldLabel}>
            {t("task.note")}
            <textarea
              className={`${field} min-h-20`}
              value={d.note}
              maxLength={NOTE_MAX}
              onChange={(e) => set("note", e.target.value)}
              placeholder={t("task.notePh")}
            />
          </label>
          {/* PleaseHelp-style one-tap notes: common instructions without typing */}
          <div className="-mt-1 flex flex-col gap-1.5">
            <span className="text-meta text-ink-2">{t("task.noteQuick")}</span>
            <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
              {NOTE_CHIPS.map((k) => {
                const phrase = t(`task.noteChips.${k}`);
                const added = d.note.includes(phrase);
                return (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={added}
                    disabled={!added && d.note.length + phrase.length + 1 > NOTE_MAX}
                    onClick={() =>
                      set(
                        "note",
                        added
                          ? d.note
                              .replace(phrase, "")
                              .replace(/\n{2,}/g, "\n")
                              .trim()
                          : [d.note.trim(), phrase].filter(Boolean).join("\n"),
                      )
                    }
                    className={chipClass(added)}
                  >
                    {added ? <Check aria-hidden size={15} /> : <Plus aria-hidden size={15} />}
                    {phrase}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <DashedAdd label={t("addressEntry.details")} onClick={() => set("showDetails", true)} />
          {arrivalSummary && <p className="px-1 text-meta text-ink-2">{arrivalSummary}</p>}
        </div>
      )}

      {CONTACTLESS_KINDS.includes(d.category) && (
        <ToggleRow
          icon={<DoorClosed aria-hidden size={22} />}
          title={t("task.contactless")}
          sub={t("task.contactlessSub")}
          checked={Boolean(d.contactless)}
          onChange={(v) => set("contactless", v)}
        />
      )}

      {d.address.trim() && !savedMatch && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-body font-medium text-ink-2">{t("task.saveAs")}</legend>
          <div className="flex gap-2" role="radiogroup">
            {(["home", "work", "other"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={d.saveAs === k}
                onClick={() => set("saveAs", d.saveAs === k ? "" : k)}
                className={chipClass(d.saveAs === k)}
              >
                <Ico as={KIND_ICON[k]} size={16} /> {t(`task.saved.${k}`)}
              </button>
            ))}
          </div>
          {d.saveAs !== "" && d.saveAs !== "other" && saved.some((a) => a.kind === d.saveAs) && (
            <p className="text-small text-ink-2">{t("task.saveReplaces", { name: t(`task.saved.${d.saveAs}`) })}</p>
          )}
        </fieldset>
      )}
    </>
  );
}
