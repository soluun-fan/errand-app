import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { MODE_COOKIE } from "@/lib/mode-cookie";
import { supabasePublishableKey, supabaseUrl } from "./env";

/** No session needed: the landing page, login, the cron tick (it checks CRON_SECRET itself), health. */
const PUBLIC_PATHS = ["/welcome", "/login", "/api/cron", "/api/health"];

/**
 * Refreshes the Supabase session cookie on every request and does an optimistic
 * redirect to /login. Pages still check the user themselves (see getViewer()).
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl(), supabasePublishableKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  // Do not put code between createServerClient and getClaims(): it refreshes the session.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  const path = request.nextUrl.pathname;
  if (!signedIn && !PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) {
    const url = request.nextUrl.clone();
    // visitors see the landing page; deep links go to login and come back after it
    url.pathname = path === "/" ? "/welcome" : "/login";
    url.search = path === "/" ? "" : `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    const redirect = NextResponse.redirect(url);
    // keep any refreshed/cleared cookies
    for (const c of response.cookies.getAll()) redirect.cookies.set(c);
    return redirect;
  }
  // Helper mode's home is the job feed (docs/ui.md tab bar). Redirect before rendering.
  if (signedIn && path === "/" && request.cookies.get(MODE_COOKIE)?.value === "helper") {
    const url = request.nextUrl.clone();
    url.pathname = "/jobs";
    const redirect = NextResponse.redirect(url);
    for (const c of response.cookies.getAll()) redirect.cookies.set(c);
    return redirect;
  }
  return response;
}
