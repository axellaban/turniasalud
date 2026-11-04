"use client";

import { useActionState } from "react";
import { runClinicAgentSetup, runStaffAgentSetup, type AgentSetupState } from "../../actions";
import { secondaryButtonClass } from "@/components/ui";

export function ClinicAgentSetup({ clinicId, disabled }: { clinicId: string; disabled: boolean }) {
  const [state, action, pending] = useActionState<AgentSetupState | undefined, FormData>(runClinicAgentSetup, undefined);
  return <form action={action} className="mt-3 space-y-2">
    <input type="hidden" name="clinic_id" value={clinicId} />
    <button disabled={disabled || pending} className={`${secondaryButtonClass} w-full`}>
      {pending ? "Preparando el agente…" : "Preparar o actualizar el agente"}
    </button>
    {state?.message && <p role="status" className={`break-words text-sm ${state.ok ? "text-brand-700" : "text-red-600"}`}>{state.message}</p>}
  </form>;
}

/** Pone a Sofi al día con las herramientas del equipo (agente general y, si hay, el de llamadas). */
export function StaffAgentSetup({ clinicId, agentName, disabled }: { clinicId: string; agentName: string; disabled: boolean }) {
  const [state, action, pending] = useActionState<AgentSetupState | undefined, FormData>(runStaffAgentSetup, undefined);
  return <form action={action} className="space-y-2">
    <input type="hidden" name="clinic_id" value={clinicId} />
    <button disabled={disabled || pending} className={`${secondaryButtonClass} w-full`}>
      {pending ? `Actualizando a ${agentName}…` : `Actualizar a ${agentName}`}
    </button>
    {state?.message && <p role="status" className={`break-words text-sm ${state.ok ? "text-brand-700" : "text-red-600"}`}>{state.message}</p>}
  </form>;
}
