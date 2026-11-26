"use client";

import "./globals.css";

/**
 * Last resort, when the root layout itself fails: it replaces the whole page, so it brings its own
 * <html> and can't use the translation provider — the message is in both languages.
 */
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="mn">
      <body className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-canvas px-5 text-center text-ink">
        <h1 className="text-title font-bold">Алдаа гарлаа · Something went wrong</h1>
        <p className="max-w-sm text-body text-ink-2">Таны мөнгө аюулгүй, юу ч өөрчлөгдөөгүй. · Your money is safe — nothing was changed.</p>
        <button onClick={() => retry()} className="mt-2 min-h-12 rounded-cta bg-brand px-6 font-bold text-white">
          Дахин оролдох · Try again
        </button>
      </body>
    </html>
  );
}
