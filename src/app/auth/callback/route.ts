import { NextResponse, type NextRequest } from "next/server";
import { isGoogleEmailAllowed } from "@/lib/google-auth-policy";
import { safeNext } from "@/lib/next-path";
import { createClient } from "@/lib/supabase/server";

function loginError(request: NextRequest, error: "google_failed" | "google_not_allowed") {
  const url = new URL("/login", request.url);
  url.searchParams.set("authError", error);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return loginError(request, "google_failed");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return loginError(request, "google_failed");

  const isGoogleIdentity = data.user.identities?.some((identity) => identity.provider === "google") ?? false;
  const emailIsVerified = Boolean(data.user.email && data.user.email_confirmed_at);
  const isAllowed = isGoogleEmailAllowed(data.user.email ?? undefined, process.env.GOOGLE_AUTH_ALLOWED_EMAILS);
  if (!isGoogleIdentity || !emailIsVerified || !isAllowed) {
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) throw new Error(`Could not sign out a blocked Google account: ${signOutError.message}`);
    return loginError(request, "google_not_allowed");
  }

  const next = safeNext(request.nextUrl.searchParams.get("next"));
  return NextResponse.redirect(new URL(next, request.url));
}
