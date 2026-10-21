"use client";

import { useActionState, useState } from "react";
import { createManualAppointment } from "../../actions";
import { Field, buttonClass, inputClass } from "@/components/ui";

type Option = { id: string; name: string; specialty: string };

export function ManualAppointmentForm({ defaultDate, professionals, types }: { defaultDate: string; professionals: Option[]; types: Option[] }) {
  const [state, action, pending] = useActionState(createManualAppointment, undefined);
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const specialty = types.find((t) => t.id === typeId)?.specialty;
  const pros = professionals.filter((p) => p.specialty === specialty);

  return (
    <form action={action} className="space-y-3">
      <Field label="Celular del paciente">
        <input name="phone" required placeholder="11 5555-0001" className={inputClass} />
      </Field>
      <Field label="Nombre y apellido">
        <input name="full_name" required className={inputClass} />
      </Field>
      <Field label="Cobertura">
        <input name="coverage" placeholder="OSDE / Particular" className={inputClass} />
      </Field>
      <Field label="Tipo de turno">
        <select name="appointment_type_id" value={typeId} onChange={(e) => setTypeId(e.target.value)} className={inputClass}>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Profesional">
        <select name="professional_id" className={inputClass} key={specialty}>
          {pros.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Fecha">
          <input type="date" name="date" required defaultValue={defaultDate} className={inputClass} />
        </Field>
        <Field label="Hora">
          <input type="time" name="time" required step={300} className={inputClass} />
        </Field>
      </div>
      <Field label="Notas">
        <input name="notes" className={inputClass} />
      </Field>
      {state?.message && <p className={`text-sm ${state.ok ? "text-brand-700" : "text-red-600"}`}>{state.message}</p>}
      <button disabled={pending} className={`${buttonClass} w-full`}>
        {pending ? "Guardando…" : "Reservar turno"}
      </button>
    </form>
  );
}
