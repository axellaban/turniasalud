"use client";

import { useActionState } from "react";
import { resolveTaskAction } from "../../actions";
import { smallButtonClass } from "@/components/ui";

/** Resolver un pedido escribiendo la respuesta que le llega al paciente por WhatsApp. */
export function ResolveTaskForm({ id, canNotify }: { id: string; canNotify: boolean }) {
  const [state, action, pending] = useActionState(resolveTaskAction, undefined);
  return (
    <form action={action} className="mt-3 space-y-2">
      <input type="hidden" name="id" value={id} />
      <textarea
        name="response"
        rows={2}
        maxLength={900}
        placeholder={canNotify ? "Respuesta para el paciente (le llega por WhatsApp). Ej.: Tu receta ya está en tu mail." : "Respuesta para el paciente (queda guardada para el agente)."}
        className="w-full rounded-lg border border-brand-900/15 px-3 py-2 text-sm"
      />
      <button disabled={pending} className={smallButtonClass}>
        {pending ? "Guardando…" : canNotify ? "Resolver y avisar al paciente" : "Resolver con respuesta"}
      </button>
      {state?.message && <p className={`text-xs ${state.ok ? "text-brand-700" : "text-red-600"}`}>{state.message}</p>}
    </form>
  );
}
