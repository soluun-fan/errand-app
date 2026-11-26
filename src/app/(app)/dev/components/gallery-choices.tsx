"use client";

import { useState } from "react";
import { DashedAdd, OptionCard, PriceDeltaCard, ToggleRow } from "@/components/choice";
import { AddressInput } from "@/components/address-input";
import { TaskBrief } from "@/components/task-brief";
import type { Pin } from "@/components/pin-map";
import { titleFromBrief } from "@/lib/task-brief";
import { useT } from "@/i18n/client";

/** Interactive samples of the choice components (dev gallery only — sample copy is not translated). */
export function GalleryChoices() {
  const [carry, setCarry] = useState(true);
  const [people, setPeople] = useState<1 | 2>(1);
  const [heavy, setHeavy] = useState(false);
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <PriceDeltaCard selected={carry} onSelect={() => setCarry(true)} icon="🧍‍♂️" title="Туслах өргөж гаргана" sub="Шатаар өргөж буулгана" delta="+6,000₮" />
        <PriceDeltaCard selected={!carry} onSelect={() => setCarry(false)} icon="🚪" title="Би доош гаргаж өгнө" sub="Орцны гадаа" delta="+0₮" free />
      </div>
      <OptionCard selected={people === 1} onSelect={() => setPeople(1)} icon="🧍" title="1 туслах" meta="~4 мин" price="21,000₮" />
      <OptionCard selected={people === 2} onSelect={() => setPeople(2)} icon="🧍🧍" title="2 туслах" sub="Хүнд эд зүйлд" price="36,000₮" />
      <OptionCard selected={false} disabled onSelect={() => {}} icon="🚗" title="Машинтай туслах" sub="Тун удахгүй" price="—" />
      <ToggleRow icon="🧊" title="Том, хүнд эд зүйл" sub="Хөргөгч, угаалгын машин…" checked={heavy} onChange={setHeavy} />
      {open ? <p className="text-small">(expanded)</p> : <DashedAdd label="Хаягийн дэлгэрэнгүй оруулах" onClick={() => setOpen(true)} />}
    </div>
  );
}

/** Local-only posting controls: empty, typed, saved-address and confirmed-pin states. */
export function GalleryPosting() {
  const t = useT();
  const [message, setMessage] = useState("");
  const [customTitle, setCustomTitle] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [pin, setPin] = useState<Pin | null>(null);
  const title = customTitle?.trim() || titleFromBrief(message, 40);
  return <div className="flex flex-col gap-4">
    <TaskBrief category="shop" value={message} title={title} titleValue={customTitle ?? title} maxLength={500} titleMax={40} onChange={setMessage} onTitleChange={setCustomTitle} />
    <AddressInput label={t("task.drop")} hint={t("addressEntry.destinationHelp")} placeholder={t("addressEntry.destinationExample")} value={address} pin={pin}
      choices={[{ id: "sample-home", kind: "home", label: t("task.saved.home"), address: "Sample building 45" }]}
      onChange={(value) => { setAddress(value); setPin(null); }} onChoose={(choice) => { setAddress(choice.address); setPin(null); }} onPinChange={setPin} />
  </div>;
}
