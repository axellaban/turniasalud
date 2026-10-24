"use client";

import { useState, type ReactNode } from "react";
import { buttonClass, ghostButtonClass } from "@/components/ui";

/** El formulario de turno manual queda plegado hasta que se lo pide. */
export function ManualPanel({ children, defaultOpen = false }: { children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!open) return <button type="button" onClick={() => setOpen(true)} className={`${buttonClass} w-full`}>+ Agregar turno a mano</button>;
  return (
    <div className="rounded-2xl border border-brand-900/10 bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold text-brand-950">Agregar turno a mano</h2>
        <button type="button" onClick={() => setOpen(false)} className={ghostButtonClass}>Cerrar</button>
      </div>
      {children}
    </div>
  );
}
