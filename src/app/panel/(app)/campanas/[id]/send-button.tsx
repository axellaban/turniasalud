"use client";

import { useActionState } from "react";
import { sendCampaignAction } from "../../../actions";
import { buttonClass } from "@/components/ui";

export function SendCampaignButton({ id, count }: { id: string; count: number }) {
  const [state, action, pending] = useActionState(sendCampaignAction, undefined);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(`¿Enviar el WhatsApp a ${count} pacientes?`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button disabled={pending || count === 0} className={`${buttonClass} w-full`}>
        {pending ? "Enviando…" : `Enviar a ${count} pacientes`}
      </button>
      {state?.message && <p className={`mt-2 text-sm ${state.ok ? "text-brand-700" : "text-red-600"}`}>{state.message}</p>}
    </form>
  );
}
