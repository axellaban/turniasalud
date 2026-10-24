"use client";

import { useActionState } from "react";
import { submitKeepingValues } from "@/components/keep-form";
import { Field, buttonClass, dangerButtonClass, inputClass } from "@/components/ui";
import { LEAD_STATUSES, type LeadStatus } from "@/lib/leads";
import { deleteLead, updateLead } from "./actions";

export function FollowupForm({ id, status, notes }: { id: string; status: LeadStatus; notes: string | null }) {
  const [state, action, pending] = useActionState(updateLead, undefined);
  return (
    <form onSubmit={submitKeepingValues(action)} className="space-y-3 border-t border-brand-900/10 pt-4">
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

/** Borrar un pedido de prueba: pide confirmación porque no se puede deshacer. */
export function DeleteLeadButton({ id, name }: { id: string; name: string }) {
  return (
    <form
      action={deleteLead}
      onSubmit={(e) => {
        if (!confirm(`¿Borrar el pedido de «${name}»? Se borran también sus demos y las fichas temporales que se armaron. No se puede deshacer.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button className={dangerButtonClass}>Borrar pedido</button>
    </form>
  );
}
