import type { ReactNode } from "react";

// Lo que con Smile Connect como fuente de la verdad se maneja allá: se ve, apagado y con candado, para
// que se entienda por qué no se puede cambiar acá y dónde se cambia. Mismo color que la etiqueta
// «Smile Connect» de las pestañas.

export function LockIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path fillRule="evenodd" d="M10 2a4 4 0 0 0-4 4v2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1V6a4 4 0 0 0-4-4Zm2 6V6a2 2 0 1 0-4 0v2h4Z" clipRule="evenodd" />
    </svg>
  );
}

/** Un bloque que se maneja en Smile Connect: título, por qué y qué hacer. */
export function SmileLock({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-dashed border-violet-300 bg-violet-50/60 p-4 text-sm ${className}`}>
      <p className="flex items-center gap-2 font-semibold text-violet-900">
        <LockIcon /> {title}
        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-800">Se maneja en Smile Connect</span>
      </p>
      <div className="mt-1 text-violet-900/80">{children}</div>
    </div>
  );
}
