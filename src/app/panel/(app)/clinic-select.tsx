"use client";

import { usePathname } from "next/navigation";
import { selectClinic } from "../clinics-actions";

/** Cambia de clínica al elegirla y se queda en la misma sección del panel. */
export function ClinicSelect({ current, options }: { current: string; options: Array<{ id: string; label: string }> }) {
  const section = usePathname().split("/").slice(0, 3).join("/");
  return (
    <form action={selectClinic} className="flex min-w-0 flex-1 items-center gap-2">
      <input type="hidden" name="return_to" value={section} />
      <label htmlFor="selected-clinic" className="hidden shrink-0 text-xs font-medium text-brand-900/60 sm:block">Clínica</label>
      <select
        key={current}
        id="selected-clinic"
        name="clinic_id"
        defaultValue={current}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="min-w-0 max-w-full flex-1 truncate rounded-xl border border-brand-900/15 bg-white px-3 py-2 text-sm font-medium text-brand-950 sm:max-w-md"
      >
        {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
      <noscript><button className="rounded-xl bg-brand-600 px-3 py-2 text-sm font-semibold text-white">Abrir</button></noscript>
    </form>
  );
}
