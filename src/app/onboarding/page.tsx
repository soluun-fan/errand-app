import { redirect } from "next/navigation";
import { getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { onboardingMissing } from "@/lib/legal-rules";
import { safeNext } from "@/lib/next-path";
import { OnboardingForm } from "./onboarding-form";

/**
 * /onboarding — the step after the SMS code for new people (name, 18+ confirmation, Terms + Privacy),
 * and the "we've updated our terms" step for everyone when a document version changes.
 */
export default async function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  const viewer = await getViewer();
  const sp = await searchParams;
  const next = safeNext(typeof sp.next === "string" ? sp.next : null);
  if (!viewer) redirect(`/login?next=${encodeURIComponent("/onboarding")}`);
  const p = viewer.profile;
  const missing = onboardingMissing({ name: p.name, age_confirmed_at: p.age_confirmed_at ?? null, terms_version: p.terms_version ?? null, privacy_version: p.privacy_version ?? null });
  if (!missing.length) redirect(next);
  const t = await getT();
  // someone who accepted an older version: only the new acceptance is asked
  const updated = Boolean(p.terms_version || p.privacy_version) && !missing.includes("name") && !missing.includes("age");
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-5 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-[26px] font-bold tracking-tight">{updated ? t("onboarding.updatedTitle") : t("onboarding.title")}</h1>
        <p className="text-[15px] text-ink-2">{updated ? t("onboarding.updatedSub") : t("onboarding.sub")}</p>
      </header>
      <OnboardingForm next={next} missing={missing} name={p.name ?? ""} />
    </main>
  );
}
