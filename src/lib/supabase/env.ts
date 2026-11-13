// Values live in .env.local (see .env.example) — never paste keys into code.
// NEXT_PUBLIC_* must be read with literal property access so Next can inline them.
export function supabaseUrl(): string {
  const v = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!v) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set — copy .env.example to .env.local");
  return v;
}

export function supabasePublishableKey(): string {
  const v = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!v) throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set — copy .env.example to .env.local");
  return v;
}
