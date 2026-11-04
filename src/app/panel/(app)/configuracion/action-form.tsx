"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { submitKeepingValues } from "@/components/keep-form";
import { buttonClass, secondaryButtonClass } from "@/components/ui";
import type { FormState } from "../../actions";

/**
 * Formulario con respuesta visible: «Guardado» o el motivo por el que no se guardó, sin perder lo
 * escrito. Con `resetOnSuccess`, se vacía al guardar (para agregar otro).
 */
export function ActionForm({ action, submit, resetOnSuccess = false, secondary = false, className = "", children }: {
  action: (previous: FormState, form: FormData) => Promise<FormState>;
  submit: string;
  resetOnSuccess?: boolean;
  secondary?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [state, run, pending] = useActionState(action, {});
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && resetOnSuccess) form.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form ref={form} onSubmit={submitKeepingValues(run)} className={className}>
      {children}
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button disabled={pending} className={secondary ? secondaryButtonClass : buttonClass}>{pending ? "Guardando…" : submit}</button>
        {state.message && (
          <p role={state.ok ? "status" : "alert"} className={`text-sm ${state.ok ? "text-brand-700" : "text-red-700"}`}>
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
