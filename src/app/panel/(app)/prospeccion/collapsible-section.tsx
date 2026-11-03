"use client";

import { useState, type ReactNode } from "react";
import { FOLD_COOKIE, parseFolds, serializeFolds } from "./folds";

function saveFold(id: string, open: boolean) {
  const raw = document.cookie.split("; ").find((c) => c.startsWith(`${FOLD_COOKIE}=`))?.slice(FOLD_COOKIE.length + 1);
  const folds = parseFolds(raw ? decodeURIComponent(raw) : undefined);
  folds[id] = open;
  document.cookie = `${FOLD_COOKIE}=${encodeURIComponent(serializeFolds(folds))}; path=/panel; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

/**
 * Una tarjeta de «Para hoy» que se pliega y despliega con un clic en el título. La elección queda en
 * una cookie, así la página la respeta desde el servidor (sin saltos) y al volver mañana sigue igual.
 */
export function CollapsibleSection({
  id,
  title,
  count,
  summary,
  defaultOpen,
  children,
}: {
  id: string;
  title: string;
  count: number;
  /** Lo que se lee con la sección plegada, al lado del título («3 abrieron su demo»). */
  summary?: string;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = `seccion-${id}`;
  const toggle = () => {
    setOpen(!open);
    saveFold(id, !open);
  };
  return (
    <section className="rounded-2xl border border-brand-900/10 bg-white">
      <h2>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={panelId}
          className="flex w-full items-center gap-3 rounded-2xl px-5 py-4 text-left hover:bg-brand-50/50 focus-visible:outline-2 focus-visible:outline-brand-500"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            className={`size-5 shrink-0 text-brand-700 transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
          >
            <path d="M7.5 4.5 13 10l-5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="font-display text-xl text-brand-950">{title}</span>
          <span className="rounded-full bg-brand-100 px-2 py-0.5 text-sm font-semibold tabular-nums text-brand-800">{count}</span>
          {summary && <span className="ml-auto hidden text-sm text-brand-900/65 sm:inline">{summary}</span>}
          <span className="sr-only">{open ? "(plegar)" : "(desplegar)"}</span>
        </button>
      </h2>
      <div id={panelId} hidden={!open} className="px-5 pb-5">
        {children}
      </div>
    </section>
  );
}
