"use client";

import { useActionState, useState, type ReactNode } from "react";
import { submitKeepingValues } from "@/components/keep-form";
import { buttonClass } from "@/components/ui";
import type { FormState } from "../../actions";

/**
 * «Editar …» desplegable con respuesta visible: al guardar se cierra y muestra
 * «Guardado»; si algo está mal, queda abierto con el motivo y lo escrito.
 */
export function EditDetails({ summary, submit, action, className = "", children }: {
  summary: string;
  submit: string;
  action: (previous: FormState, form: FormData) => Promise<FormState>;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [state, run, pending] = useActionState(async (previous: FormState, form: FormData) => {
    const result = await action(previous, form);
    if (result.ok) setOpen(false);
    return result;
  }, {});
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className="mt-1">
      <summary className="cursor-pointer text-sm font-medium text-brand-700">
        {summary}
        {!open && state.ok && <span role="status" className="ml-2 font-normal text-brand-700">· {state.message} ✓</span>}
      </summary>
      <form onSubmit={submitKeepingValues(run)} className={className}>
        {children}
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <button disabled={pending} className={buttonClass}>{pending ? "Guardando…" : submit}</button>
          {state.ok === false && <p role="alert" className="text-sm text-red-700">{state.message}</p>}
        </div>
      </form>
    </details>
  );
}
