"use client";

import { useActionState, useState } from "react";
import { saveContactRulesAction } from "../../campaign-actions";
import { secondaryButtonClass } from "@/components/ui";

const INACTIVE = [6, 9, 12, 18, 24];
const COOLDOWN: Array<[number, string]> = [
  [7, "Una vez por semana"],
  [14, "Una vez cada 2 semanas"],
  [30, "Una vez por mes"],
  [60, "Una vez cada 2 meses"],
  [90, "Una vez cada 3 meses"],
  [0, "Sin tope"],
];

const selectClass = "w-full rounded-xl border border-brand-900/15 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500";

export function ContactRules({ clinicId, reactivation, cooldown }: { clinicId: string; reactivation: number; cooldown: number }) {
  const [state, action, pending] = useActionState(saveContactRulesAction, undefined);
  const [months, setMonths] = useState(String(reactivation));
  const [days, setDays] = useState(String(cooldown));
  const monthOptions = INACTIVE.includes(reactivation) ? INACTIVE : [...INACTIVE, reactivation].sort((a, b) => a - b);
  const dayOptions = COOLDOWN.some(([d]) => d === cooldown) ? COOLDOWN : [...COOLDOWN, [cooldown, `Una vez cada ${cooldown} días`] as [number, string]];
  return (
    <form action={action} className="space-y-3 text-sm">
      <input type="hidden" name="clinic_id" value={clinicId} />
      <label className="block">
        <span className="font-medium text-brand-900">Un paciente está inactivo después de</span>
        <select name="reactivation_months" value={months} onChange={(e) => setMonths(e.target.value)} className={`mt-1 ${selectClass}`}>
          {monthOptions.map((m) => (
            <option key={m} value={m}>
              {m} meses sin venir
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="font-medium text-brand-900">Para volver a sacar turno, como mucho</span>
        <select name="contact_cooldown_days" value={days} onChange={(e) => setDays(e.target.value)} className={`mt-1 ${selectClass}`}>
          {dayOptions.map(([d, label]) => (
            <option key={d} value={d}>
              {label}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-brand-900/65">
          Vale entre controles, inactivos y ausentes: a quien le escribiste hace poco no le llega otro. Recordatorios y lista de espera no cuentan.
        </span>
      </label>
      <div className="flex items-center gap-3">
        <button disabled={pending} className={secondaryButtonClass}>
          {pending ? "Guardando…" : "Guardar reglas"}
        </button>
        <span aria-live="polite" className={`text-xs ${state?.ok === false ? "text-red-600" : "text-brand-700"}`}>
          {!pending && state?.message}
        </span>
      </div>
    </form>
  );
}
