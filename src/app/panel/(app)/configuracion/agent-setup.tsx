"use client";

import { useActionState } from "react";
import { runAgentSetup, type AgentSetupState } from "../../actions";
import { buttonClass } from "@/components/ui";

export function AgentSetupButton({ disabled }: { disabled: boolean }) {
  const [state, action, pending] = useActionState<AgentSetupState | undefined>(runAgentSetup, undefined);
  return (
    <form action={action}>
      <button disabled={disabled || pending} className={`${buttonClass} w-full`}>
        {pending ? "Configurando…" : "Crear / actualizar agente"}
      </button>
      {state?.message && <p className={`mt-2 break-words text-sm ${state.ok ? "text-brand-700" : "text-red-600"}`}>{state.message}</p>}
    </form>
  );
}
