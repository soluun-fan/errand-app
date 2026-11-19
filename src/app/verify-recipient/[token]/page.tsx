import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale } from "@/i18n/server";
import { recipientVerificationFromShareLink } from "@/lib/verify-mn";
import { RecipientVerification } from "./recipient-verification";

export const metadata: Metadata = {
  title: "Phone verification",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function RecipientVerificationPage({ params }: PageProps<"/verify-recipient/[token]">) {
  const { token } = await params;
  const verification = await recipientVerificationFromShareLink(token);
  if (!verification) notFound();
  const inviteValid = Date.parse(verification.inviteExpiresAt) > Date.now();
  const locale = await getLocale();
  return (
    <div lang={locale}>
      <RecipientVerification token={token} verification={verification} inviteValid={inviteValid} />
    </div>
  );
}
