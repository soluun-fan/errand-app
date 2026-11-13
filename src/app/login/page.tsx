import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth";
import { devShowSmsCodes } from "./actions";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  if (await getViewer()) redirect("/");

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 px-4 py-12">
      <div className="flex flex-col gap-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-700 text-lg font-bold text-white">
          T
        </span>
        <h1 className="text-2xl font-bold">Sign in to Tuslamj</h1>
        <p className="text-sm text-zinc-600">We&apos;ll text you a code. No password needed.</p>
      </div>
      <LoginForm showDemoHint={await devShowSmsCodes()} />
    </main>
  );
}
