"use client";

import { useActionState } from "react";
import { runClinicAgentSetup, type AgentSetupState } from "../../actions";
import { secondaryButtonClass } from "@/components/ui";

export function ClinicAgentSetup({ clinicId, disabled }: { clinicId: string; disabled: boolean }) {
  const [state, action, pending] = useActionState<AgentSetupState | undefined, FormData>(runClinicAgentSetup, undefined);
  return <form action={action} className="mt-3 space-y-2">
    <input type="hidden" name="clinic_id" value={clinicId} />
    <button disabled={disabled || pending} className={`${secondaryButtonClass} w-full`}>
      {pending ? "Preparando a Sofi…" : "Crear / actualizar Sofi de esta clínica"}
    </button>
    {state?.message && <p role="status" className={`break-words text-sm ${state.ok ? "text-brand-700" : "text-red-600"}`}>{state.message}</p>}
  </form>;
}
