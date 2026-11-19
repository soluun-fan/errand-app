import { redirect } from "next/navigation";
import { LOCALES } from "@/i18n";
import { getLocale, getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { devShowSmsCodes } from "@/lib/dev";
import { googleAuthEnabled } from "@/lib/google-auth-policy";
import { safeNext } from "@/lib/next-path";
import { setLocale } from "@/lib/prefs";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = safeNext(params.next);
  if (await getViewer()) redirect(next);
  const [t, locale] = await Promise.all([getT(), getLocale()]);
  const googleError = params.authError === "google_not_allowed" ? "notAllowed" : params.authError === "google_failed" ? "failed" : undefined;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 px-4 py-12">
      <form action={setLocale} className="flex justify-end gap-1">
        {LOCALES.map((l) => (
          <button
            key={l}
            name="locale"
            value={l}
            aria-pressed={l === locale}
            className={`min-h-11 rounded-lg px-3 text-sm font-semibold ${l === locale ? "bg-ink text-white" : "text-ink-2"}`}
          >
            {t(`lang.${l}`)}
          </button>
        ))}
      </form>
      <div className="flex flex-col gap-2">
        <span className="flex h-11 w-11 items-center justify-center rounded-input bg-brand text-lg font-bold text-white">T</span>
        <h1 className="text-2xl font-bold">{t("login.title")}</h1>
        <p className="text-[15px] text-ink-2">{t("login.sub")}</p>
      </div>
      <LoginForm
        showDemoHint={devShowSmsCodes()}
        googleEnabled={googleAuthEnabled(process.env.GOOGLE_AUTH_ALLOWED_EMAILS)}
        googleError={googleError}
        next={next}
      />
    </main>
  );
}
