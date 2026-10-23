"use client";

import { useActionState } from "react";
import { addScheduleBlock } from "../../actions";
import { Field, buttonClass, inputClass } from "@/components/ui";

export function ScheduleBlockForm({ professionals, today, clinicId }: { clinicId?: string; professionals: Array<{ id: string; name: string }>; today: string }) {
  const [state, action, pending] = useActionState(addScheduleBlock, undefined);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      {clinicId && <input type="hidden" name="clinic_id" value={clinicId} />}
      <Field label="Quién no atiende">
        <select name="professional_id" className={inputClass} defaultValue="">
          <option value="">Toda la clínica (feriado, cierre)</option>
          {professionals.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Motivo" hint="El agente lo menciona si el paciente pide ese día.">
        <input name="reason" placeholder="Feriado, vacaciones, congreso…" className={inputClass} />
      </Field>
      <Field label="Desde el día">
        <input name="date_from" type="date" required min={today} defaultValue={today} className={inputClass} />
      </Field>
      <Field label="Hasta el día (inclusive)">
        <input name="date_to" type="date" min={today} className={inputClass} />
      </Field>
      <Field label="Hora de inicio (opcional)" hint="Vacío = desde el comienzo del día.">
        <input name="time_from" type="time" className={inputClass} />
      </Field>
      <Field label="Hora de fin (opcional)" hint="Vacío = hasta el final del último día.">
        <input name="time_to" type="time" className={inputClass} />
      </Field>
      <div className="sm:col-span-2">
        <button disabled={pending} className={buttonClass}>
          {pending ? "Guardando…" : "Bloquear agenda"}
        </button>
        {state?.message && <p className={`mt-2 text-sm ${state.ok ? "text-brand-700" : "text-red-600"}`}>{state.message}</p>}
      </div>
    </form>
  );
}
