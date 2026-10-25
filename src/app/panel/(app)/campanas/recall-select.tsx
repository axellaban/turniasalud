"use client";

import { useActionState, useState } from "react";
import { setRecallMonthsAction } from "../../campaign-actions";

const OPTIONS: Array<[string, string]> = [
  ["", "Sin control"],
  ["1", "Mensual"],
  ["3", "Trimestral"],
  ["4", "Cada 4 meses"],
  ["6", "Semestral"],
  ["12", "Anual"],
  ["18", "Cada 18 meses"],
  ["24", "Cada 2 años"],
];

/** Cada cuánto vuelve un paciente por esta prestación: se guarda al elegir. */
export function RecallSelect({ clinicId, typeId, name, value }: { clinicId: string; typeId: string; name: string; value: number | null }) {
  const [state, action, pending] = useActionState(setRecallMonthsAction, undefined);
  const [months, setMonths] = useState(value ? String(value) : "");
  const options = OPTIONS.some(([v]) => v === months) ? OPTIONS : [...OPTIONS, [months, `Cada ${months} meses`] as [string, string]];
  return (
    <form action={action} className="flex flex-col items-end gap-0.5">
      <input type="hidden" name="clinic_id" value={clinicId} />
      <input type="hidden" name="id" value={typeId} />
      <select
        name="recall_months"
        aria-label={`Control periódico de ${name}`}
        value={months}
        disabled={pending}
        onChange={(e) => {
          setMonths(e.target.value);
          e.currentTarget.form?.requestSubmit();
        }}
        className={`w-36 rounded-lg border px-2 py-1 text-sm outline-none focus:border-brand-500 disabled:opacity-60 ${
          months ? "border-brand-200 bg-brand-50/60 font-medium text-brand-900" : "border-brand-900/15 bg-white text-brand-900/60"
        }`}
      >
        {options.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>
      <span aria-live="polite" className={`min-h-4 text-[11px] ${state?.ok === false ? "text-red-600" : "text-brand-900/55"}`}>
        {pending ? "Guardando…" : state?.ok === false ? state.message : state?.ok ? "Guardado" : ""}
      </span>
    </form>
  );
}
