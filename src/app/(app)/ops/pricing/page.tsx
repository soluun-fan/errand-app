import { notFound } from "next/navigation";
import { Card, FlowHeader } from "@/components/ui";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { DEFAULT_DETAILS, priceRange, quoteFee, serviceFeeFor, type CategoryId, type ErrandDetails } from "@/lib/engine";
import { fmtMoney } from "@/lib/format";
import { getPricing, kindMinimums, pricingConfig } from "@/lib/pricing";
import { CATEGORIES } from "@/lib/engine";
import { KindMinForm } from "./kind-min-form";
import { PricingForm } from "./pricing-form";
import { titled } from "@/lib/page-title";

export const generateMetadata = titled("opsPricing.title");

const DAY = Date.UTC(2026, 10, 16, 4); // 12:00 Ulaanbaatar — examples are priced by day

/** Sample jobs priced with the current settings, so Ops sees the effect of a change at a glance. */
const EXAMPLES: {
  key: "groceries" | "groceriesFar" | "queue" | "wardrobe" | "fridge";
  category: CategoryId;
  details: Partial<ErrandDetails>;
}[] = [
  { key: "groceries", category: "shop", details: { km: 1 } },
  { key: "groceriesFar", category: "shop", details: { km: 3 } },
  { key: "queue", category: "queue", details: { minutes: 120 } },
  { key: "wardrobe", category: "repair", details: { minutes: 120, tools: true } },
  { key: "fridge", category: "carry", details: { minutes: 60, heavy: true, floor: 5, lift: "no", people: 2 } },
];

/** /ops/pricing — the live price list, with worked examples. Admins only. */
export default async function OpsPricingPage() {
  const viewer = await getViewer();
  if (!viewer || viewer.profile.role !== "admin") notFound();
  const [t, p, cfg, kinds] = await Promise.all([getT(), getPricing(), pricingConfig(), kindMinimums()]);
  return (
    <>
      <FlowHeader href="/ops" label={t("common.back")} title={t("opsPricing.title")} />
      <Card>
        <h2 className="font-bold">{t("opsPricing.examples")}</h2>
        <ul className="flex flex-col gap-1.5 text-body">
          {EXAMPLES.map((x) => {
            const q = quoteFee(x.category, { ...DEFAULT_DETAILS, ...x.details }, cfg, DAY);
            const r = priceRange(q.total, DAY, cfg);
            return (
              <li key={x.key} className="flex justify-between gap-3">
                <span>{t(`opsPricing.ex.${x.key}`)}</span>
                <span className="text-right tabular-nums">
                  <b className="text-brand-ink">{fmtMoney(q.total)}</b>
                  <span className="block text-small text-ink-2">
                    {fmtMoney(r.min)}–{fmtMoney(r.max)} · +{fmtMoney(serviceFeeFor(q.total, cfg))}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
        <p className="text-small text-ink-2">{t("opsPricing.examplesHelp")}</p>
      </Card>
      <section className="flex flex-col gap-3">
        <h2 className="font-bold">{t("opsPricing.kindsTitle")}</h2>
        <p className="text-small text-ink-2">{t("opsPricing.kindsHelp")}</p>
        <div className="flex flex-col rounded-card bg-bg shadow-card">
          {CATEGORIES.map((c) => {
            const k = kinds.find((x) => x.category === c.id);
            if (!k) throw new Error(`Category settings missing: ${c.id}`);
            return <KindMinForm key={c.id} {...k} general={p.baseFee} />;
          })}
        </div>
      </section>
      <PricingForm p={p} />
    </>
  );
}
