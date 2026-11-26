import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getT } from "@/i18n/server";
import { recipientVerificationFromShareLink } from "@/lib/verify-mn";
import { RecipientVerification } from "./recipient-verification";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("verifyRecipient.publicTitle"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}

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
