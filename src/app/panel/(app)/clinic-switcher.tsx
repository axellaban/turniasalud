import { sql } from "@/lib/db";
import { getPanelClinic } from "@/lib/panel-clinic";
import { selectClinic } from "../clinics-actions";

export async function ClinicSwitcher() {
  const clinic = await getPanelClinic();
  const clinics = await sql<{ id: string; name: string }[]>`select id, name from clinics order by is_demo, name`;
  return <form action={selectClinic} className="border-b border-brand-900/10 bg-brand-50/60 px-4 py-3 sm:px-8">
    <label htmlFor="selected-clinic" className="mr-3 text-sm font-medium text-brand-950">Clínica seleccionada</label>
    <select id="selected-clinic" name="clinic_id" defaultValue={clinic.id} className="max-w-full rounded-lg border border-brand-900/15 bg-white px-3 py-2 text-sm sm:max-w-[440px]">
      {clinics.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
    </select>
    <button className="ml-2 rounded-lg bg-brand-950 px-3 py-2 text-sm text-white">Abrir clínica</button>
    <p className="mt-1 text-xs text-brand-900/60">Configuración, agenda, pacientes y conversaciones corresponden a esta clínica. Pedidos de demo y conexiones generales se administran por separado.</p>
  </form>;
}
