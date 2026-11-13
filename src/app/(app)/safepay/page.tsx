import { EmptyState, FlowHeader } from "@/components/ui";
import { getT } from "@/i18n/server";

export default async function SafePayPage() {
  const t = await getT();
  return (
    <>
      <FlowHeader href="/" label={t("common.back")} title={t("categoryShort.safepay")} />
      <EmptyState icon="🛡️" title={t("categoryShort.safepay")} body={t("placeholder.safepay")} />
    </>
  );
}
