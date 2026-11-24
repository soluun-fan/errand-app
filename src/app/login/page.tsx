import { redirect } from "next/navigation";
import { APP_MARK } from "@/lib/brand";
import { LOCALES } from "@/i18n";
import { getLocale, getT } from "@/i18n/server";
import { getViewer } from "@/lib/auth";
import { devShowSmsCodes } from "@/lib/dev";
import { safeNext } from "@/lib/next-path";
import { setLocale } from "@/lib/prefs";
import { pendingLogin, verifyMnLoginEnabled } from "@/lib/verify-mn-login";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const next = safeNext((await searchParams).next);
  if (await getViewer()) redirect(next);
  const [t, locale] = await Promise.all([getT(), getLocale()]);

  const verifyMn = verifyMnLoginEnabled();
  const pending = verifyMn ? await pendingLogin() : null;

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
        <span className="flex h-11 w-11 items-center justify-center rounded-input bg-brand text-lg font-bold text-white">{APP_MARK}</span>
        <h1 className="text-2xl font-bold">{t("login.title")}</h1>
        <p className="text-[15px] text-ink-2">{t(verifyMn ? "login.verifyIntro" : "login.sub")}</p>
      </div>
      <LoginForm verifyMn={verifyMn} pending={pending} showDemoHint={!verifyMn && devShowSmsCodes()} next={next} />
    </main>
  );
}
