"use client";

import { useActionState } from "react";
import { submitKeepingValues } from "@/components/keep-form";
import { inputClass, smallButtonClass } from "@/components/ui";
import { saveProfessionalCalendar } from "../../calendar-actions";

/** El calendario de Google de un profesional: se guarda solo esa fila. */
export function ProfessionalCalendarForm({
  clinicId,
  professionalId,
  current,
  calendars,
}: {
  clinicId: string;
  professionalId: string;
  current: string | null;
  calendars: Array<{ id: string; name: string; primary: boolean }>;
}) {
  const [state, action, pending] = useActionState(saveProfessionalCalendar, undefined);
  const known = !current || calendars.some((c) => c.id === current);
  return (
    <form onSubmit={submitKeepingValues(action)} className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <input type="hidden" name="clinic_id" value={clinicId} />
      <input type="hidden" name="professional_id" value={professionalId} />
      <label className="sr-only" htmlFor={`cal-${professionalId}`}>Calendario de Google</label>
      <select id={`cal-${professionalId}`} name="calendar_id" defaultValue={current ?? ""} className={`${inputClass} sm:max-w-xs`}>
        <option value="">Sin calendario (no se sincroniza)</option>
        {!known && <option value={current!}>Calendario que ya no está en la cuenta</option>}
        {calendars.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}{c.primary ? " (principal)" : ""}
          </option>
        ))}
      </select>
      <button disabled={pending} className={smallButtonClass}>{pending ? "Guardando…" : "Guardar"}</button>
      {state?.message && <p role="status" className={`text-sm ${state.ok ? "text-brand-700" : "text-red-700"}`}>{state.message}</p>}
    </form>
  );
}
