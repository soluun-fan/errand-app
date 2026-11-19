/** Google sign-in is enabled only when the private deployment has an explicit email allowlist. */
export function googleAuthEmails(value: string | undefined): readonly string[] {
  return [...new Set((value ?? "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean))];
}

export function googleAuthEnabled(value: string | undefined): boolean {
  return googleAuthEmails(value).length > 0;
}

export function isGoogleEmailAllowed(email: string | undefined, allowlist: string | undefined): boolean {
  if (!email) return false;
  return googleAuthEmails(allowlist).includes(email.trim().toLowerCase());
}
