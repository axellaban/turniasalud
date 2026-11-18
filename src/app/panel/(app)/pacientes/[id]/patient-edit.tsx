"use client";

import { Field, inputClass } from "@/components/ui";
import { updatePatientDetails } from "../../../actions";
import { ActionForm } from "../../configuracion/action-form";
import type { Patient } from "@/lib/types";

/** El celular como se escribe en la Argentina (sin el 549 de WhatsApp), para editarlo cómodo. */
const localPhone = (phone: string | null) => (phone ? phone.replace(/^549?/, "") : "");

/** Ficha del paciente → «Editar datos»: todo lo que se ve en la ficha, más la memoria y las notas. */
export function PatientEdit({ patient: p, clinicId, linkedToSmile }: { patient: Patient; clinicId: string; linkedToSmile: boolean }) {
  return (
    <details className="mt-4 border-t border-brand-900/5 pt-3">
      <summary className="cursor-pointer text-sm font-semibold text-brand-700">Editar datos</summary>
      <ActionForm action={updatePatientDetails} submit="Guardar datos" className="mt-3 grid gap-3">
        <input type="hidden" name="id" value={p.id} />
        <input type="hidden" name="clinic_id" value={clinicId} />
        {linkedToSmile && (
          <p className="rounded-lg bg-sun-100/60 px-3 py-2 text-xs text-brand-900/80">
            Esta ficha está vinculada con Smile Connect. Smile Connect no deja editar pacientes desde Turnia: si cambiás el nombre, el DNI o el celular, cambialo también allá.
          </p>
        )}
        <Field label="Nombre y apellido"><input name="full_name" required maxLength={120} defaultValue={p.full_name ?? ""} className={inputClass} /></Field>
        <Field label="Celular" hint="Con código de área. El anterior sigue reconociendo la ficha.">
          <input name="phone" inputMode="tel" defaultValue={localPhone(p.phone)} placeholder="11 5555-0100" className={inputClass} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="DNI"><input name="dni" inputMode="numeric" defaultValue={p.dni ?? ""} className={inputClass} /></Field>
          <Field label="Nacimiento"><input name="birth_date" type="date" defaultValue={p.birth_date ?? ""} className={inputClass} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Sexo">
            <select name="sex" defaultValue={p.sex ?? ""} className={inputClass}>
              <option value="">—</option>
              <option value="femenino">Femenino</option>
              <option value="masculino">Masculino</option>
              <option value="otro">Otro</option>
            </select>
          </Field>
          <Field label="Email"><input name="email" type="email" defaultValue={p.email ?? ""} className={inputClass} /></Field>
        </div>
        <Field label="Dirección"><input name="address" defaultValue={p.address ?? ""} className={inputClass} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Cobertura"><input name="coverage" defaultValue={p.coverage ?? ""} placeholder="OSDE, Particular…" className={inputClass} /></Field>
          <Field label="Plan"><input name="coverage_plan" defaultValue={p.coverage_plan ?? ""} className={inputClass} /></Field>
        </div>
        <Field label="N° de afiliado"><input name="member_number" defaultValue={p.member_number ?? ""} className={inputClass} /></Field>
        <Field label="Preferencias" hint="Por ejemplo: prefiere turnos a la mañana."><input name="preferences" defaultValue={p.preferences ?? ""} className={inputClass} /></Field>
        <Field label="Memoria del paciente" hint="Lo que Sofi recuerda de charlas anteriores. Podés corregirla o borrar lo que ya no vale.">
          <textarea name="memory_summary" rows={3} defaultValue={p.memory_summary ?? ""} className={inputClass} />
        </Field>
        <Field label="Notas" hint="Solo las ve el consultorio."><textarea name="notes" rows={2} defaultValue={p.notes ?? ""} className={inputClass} /></Field>
      </ActionForm>
    </details>
  );
}
