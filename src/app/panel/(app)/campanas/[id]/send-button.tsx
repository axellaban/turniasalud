"use client";

import { useActionState } from "react";
import { sendCampaignAction } from "../../../campaign-actions";
import { secondaryButtonClass } from "@/components/ui";

const PER_RUN = 50;

export function SendCampaignButton({ clinicId, id, count }: { clinicId: string; id: string; count: number }) {
  const [state, action, pending] = useActionState(sendCampaignAction, undefined);
  const batch = Math.min(count, PER_RUN);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(`¿Sofi le manda el WhatsApp a ${batch} ${batch === 1 ? "paciente" : "pacientes"}?`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="clinic_id" value={clinicId} />
      <input type="hidden" name="id" value={id} />
      <button disabled={pending || count === 0} className={`${secondaryButtonClass} w-full disabled:opacity-50`}>
        {pending ? "Enviando…" : count > PER_RUN ? `Que Sofi envíe a los próximos ${PER_RUN} (de ${count})` : `Que Sofi envíe a ${count} ${count === 1 ? "paciente" : "pacientes"}`}
      </button>
      {state?.message && <p className={`mt-2 text-sm ${state.ok ? "text-brand-700" : "text-red-600"}`}>{state.message}</p>}
    </form>
  );
}
