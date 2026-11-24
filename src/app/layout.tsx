import type { Metadata, Viewport } from "next";
import { Onest } from "next/font/google";
import { I18nProvider } from "@/i18n/client";
import { getLocale, getT } from "@/i18n/server";
import "./globals.css";
import { APP_NAME } from "@/lib/brand";
import { ErrorReporter } from "@/components/error-reporter";
import { Analytics } from "@vercel/analytics/next";

// Onest has every Mongolian letter. Ө ө Ү ү live in the cyrillic-ext subset — without it they
// fall back to another font (UI-FLOWS §12: Mongolian renders in the same face as Latin).
const onest = Onest({ variable: "--font-onest", subsets: ["latin", "cyrillic", "cyrillic-ext"] });

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: APP_NAME, description: t("common.description") };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f5f4f2",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={`${onest.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-canvas text-ink">
        <I18nProvider locale={locale}>{children}</I18nProvider>
        {/* uncaught browser errors → the Ops error log */}
        <ErrorReporter />
        {process.env.VERCEL === "1" && <Analytics />}
      </body>
    </html>
  );
}
