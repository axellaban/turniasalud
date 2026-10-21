"use client";

import { useActionState } from "react";
import { Field, buttonClass, inputClass } from "@/components/ui";
import { LEAD_STATUSES, type LeadStatus } from "@/lib/leads";
import { updateLead } from "./actions";

export function FollowupForm({ id, status, notes }: { id: string; status: LeadStatus; notes: string | null }) {
  const [state, action, pending] = useActionState(updateLead, undefined);
  return (
    <form action={action} className="space-y-3 border-t border-brand-900/10 pt-4">
      <input type="hidden" name="id" value={id} />
      <Field label="Estado de seguimiento">
        <select name="status" defaultValue={status} className={inputClass}>
          {Object.entries(LEAD_STATUSES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </Field>
      <Field label="Notas internas">
        <textarea name="notes" defaultValue={notes ?? ""} maxLength={2000} rows={2} className={inputClass} placeholder="Próximo contacto, fecha de la demo…" />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} className={buttonClass}>{pending ? "Guardando…" : "Guardar seguimiento"}</button>
        {state?.message && <p role="status" className={`text-sm ${state.ok ? "text-brand-700" : "text-red-700"}`}>{state.message}</p>}
      </div>
    </form>
  );
}
