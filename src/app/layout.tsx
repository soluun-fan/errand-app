import type { Metadata, Viewport } from "next";
import { Onest } from "next/font/google";
import { I18nProvider } from "@/i18n/client";
import { getLocale } from "@/i18n/server";
import "./globals.css";
import { ErrorReporter } from "@/components/error-reporter";

// Onest has every Mongolian letter. Ө ө Ү ү live in the cyrillic-ext subset — without it they
// fall back to another font (UI-FLOWS §12: Mongolian renders in the same face as Latin).
const onest = Onest({ variable: "--font-onest", subsets: ["latin", "cyrillic", "cyrillic-ext"] });

export const metadata: Metadata = {
  title: "Tuslamj",
  description: "Errands and protected payments, held by the bank until the job is done.",
};

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
      </body>
    </html>
  );
}
