import { ChevronRight, Clock } from "lucide-react";
import Link from "next/link";
import type { T } from "@/i18n";
import type { Todo } from "@/lib/todo";

/**
 * "Хийх зүйл" — what the app needs from you, at the top of the screen. Every item that needs you is
 * a big row that opens the page where you do it; waiting items say what happens next.
 */
export function TodoCard({ items, t }: { items: Todo[]; t: T }) {
  if (!items.length) return null;
  const sorted = [...items].sort((a, b) => Number(Boolean(b.urgent)) - Number(Boolean(a.urgent)));
  return (
    <section aria-labelledby="todo-title" className="flex flex-col gap-1 rounded-card border-2 border-brand bg-bg p-2 shadow-card">
      <h2 id="todo-title" className="px-2 pt-1 text-meta font-bold uppercase tracking-wide text-brand-ink">
        {t("todo.title", { n: sorted.filter((i) => i.href).length || sorted.length })}
      </h2>
      <ul className="flex flex-col">
        {sorted.map((i, n) => {
          const body = (
            <>
              <span className="min-w-0 flex-1">
                <span className="block text-body font-semibold leading-snug">{t(`todo.${i.key}.title`)}</span>
                <span className="block text-meta leading-snug text-ink-2">{i.detail ? `${i.detail} · ` : ""}{t(`todo.${i.key}.body`)}</span>
              </span>
              {i.href ? (
                <span className="flex flex-none items-center gap-0.5 rounded-full bg-brand px-3 py-1.5 text-meta font-bold text-white">
                  {t(`todo.${i.key}.go`)} <ChevronRight aria-hidden size={15} />
                </span>
              ) : (
                <Clock aria-hidden size={18} className="flex-none text-ink-2" />
              )}
            </>
          );
          const cls = "flex min-h-14 items-center gap-3 rounded-input px-2 py-2";
          return (
            <li key={`${i.key}-${n}`}>
              {i.href ? (
                <Link href={i.href} className={`press ${cls} hover:bg-fill`}>
                  {body}
                </Link>
              ) : (
                <div className={cls}>{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
