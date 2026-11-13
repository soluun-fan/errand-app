"use client";

import { useState } from "react";
import { DashedAdd, OptionCard, PriceDeltaCard, ToggleRow } from "@/components/choice";

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
      {open ? <p className="text-sm">(expanded)</p> : <DashedAdd label="Хаягийн дэлгэрэнгүй оруулах" onClick={() => setOpen(true)} />}
    </div>
  );
}
