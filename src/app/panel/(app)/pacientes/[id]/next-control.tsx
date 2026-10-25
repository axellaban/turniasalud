"use client";

import { useActionState } from "react";
import { setNextControlAction } from "../../../campaign-actions";
import { smallButtonClass } from "@/components/ui";

const fieldClass = "w-full rounded-lg border border-brand-900/15 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-brand-500";

/** Control indicado para este paciente: cuando llega la fecha, aparece en «Controles vencidos». */
export function NextControl({ clinicId, patientId, date, reason }: { clinicId: string; patientId: string; date: string | null; reason: string | null }) {
  const [state, action, pending] = useActionState(setNextControlAction, undefined);
  return (
    <form action={action} className="space-y-2 text-sm">
      <input type="hidden" name="clinic_id" value={clinicId} />
      <input type="hidden" name="id" value={patientId} />
      <div className="grid grid-cols-[auto_1fr] items-center gap-2">
        <label htmlFor="next_control_at" className="text-brand-900/65">
          Fecha
        </label>
        <input id="next_control_at" name="next_control_at" type="date" defaultValue={date ?? ""} className={fieldClass} />
        <label htmlFor="next_control_reason" className="text-brand-900/65">
          Motivo
        </label>
        <input id="next_control_reason" name="next_control_reason" defaultValue={reason ?? ""} placeholder="Control de ortodoncia" maxLength={120} className={fieldClass} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <span aria-live="polite" className={`text-xs ${state?.ok === false ? "text-red-600" : "text-brand-700"}`}>
          {!pending && state?.message}
        </span>
        <button disabled={pending} className={smallButtonClass}>
          {pending ? "Guardando…" : "Guardar control"}
        </button>
      </div>
    </form>
  );
}
