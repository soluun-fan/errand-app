import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth";
import { formatMnPhone } from "@/lib/phone";
import { signOut } from "./login/actions";

const ROLE_LABEL = { customer: "Customer", helper: "Helper", admin: "Operations" } as const;

export default async function Home() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const { profile, actor } = viewer;

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-10">
      <header className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-zinc-500">Signed in as</p>
          <h1 className="text-2xl font-bold">{profile.name || "New user"}</h1>
        </div>
        <form action={signOut}>
          <button className="h-11 rounded-xl border border-zinc-300 px-4 text-sm font-semibold">Sign out</button>
        </form>
      </header>

      <section className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-5 text-sm">
        <Row label="Phone" value={profile.phone ? formatMnPhone(profile.phone) : "—"} />
        <Row label="Role" value={ROLE_LABEL[profile.role]} />
        <Row label="Verification level" value={String(profile.kyc_level)} />
        {profile.role === "helper" && (
          <Row
            label="Helper status"
            value={actor.helperApproved ? "Approved — can take tasks" : (profile.helper_status ?? "not applied")}
          />
        )}
      </section>

      <p className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-900">
        Sign-in, profiles and the deal engine are in place. Posting tasks, the helper feed, SafePay and
        the Ops panel come next (CLAUDE.md §10, steps 3–7).
      </p>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-zinc-500">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
