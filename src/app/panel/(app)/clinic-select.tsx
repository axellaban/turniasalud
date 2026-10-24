"use client";

import { usePathname } from "next/navigation";
import { selectClinic } from "../clinics-actions";
import { confirmDiscardUnsaved } from "@/components/unsaved-changes";

/** Cambia de clínica al elegirla y se queda en la misma sección del panel. */
export function ClinicSelect({ current, options }: { current: string; options: Array<{ id: string; label: string }> }) {
  // Se queda en la misma sección (y pestaña); las páginas de un paciente o una
  // conversación vuelven a su listado, porque son de la clínica anterior.
  const section = usePathname().split("/").filter((part) => part && !/\d/.test(part)).slice(0, 3).map((part) => `/${part}`).join("");
  return (
    <form action={selectClinic} className="flex min-w-0 flex-1 items-center gap-2">
      <input type="hidden" name="return_to" value={section} />
      <label htmlFor="selected-clinic" className="sr-only shrink-0 text-xs font-medium text-brand-900/60 sm:not-sr-only">Clínica</label>
      <select
        key={current}
        id="selected-clinic"
        name="clinic_id"
        defaultValue={current}
        onChange={(e) => {
          // Con cambios sin guardar, cambiar de clínica los perdería: primero se pregunta.
          if (!confirmDiscardUnsaved()) { e.currentTarget.value = current; return; }
          e.currentTarget.form?.requestSubmit();
        }}
        className="min-w-0 max-w-full flex-1 truncate rounded-xl border border-brand-900/15 bg-white px-3 py-2 text-sm font-medium text-brand-950 sm:max-w-md"
      >
        {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
      <noscript><button className="rounded-xl bg-brand-600 px-3 py-2 text-sm font-semibold text-white">Abrir</button></noscript>
    </form>
  );
}
