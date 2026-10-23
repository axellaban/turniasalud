import { sql } from "@/lib/db";
import { getPanelClinic } from "@/lib/panel-clinic";
import { selectClinic } from "../clinics-actions";
import { formatDateTime } from "@/lib/time";

export async function ClinicSwitcher() {
  const clinic = await getPanelClinic();
  const clinics = await sql<{ id: string; name: string; created_at: string }[]>`select id, name, created_at from clinics order by is_demo, name, created_at desc`;
  const counts = new Map<string, number>();
  for (const row of clinics) counts.set(row.name, (counts.get(row.name) ?? 0) + 1);
  return <form action={selectClinic} className="border-b border-brand-900/10 bg-brand-50/60 px-4 py-3 sm:px-8">
    <label htmlFor="selected-clinic" className="mr-3 text-sm font-medium text-brand-950">Clínica seleccionada</label>
    <select key={clinic.id} id="selected-clinic" name="clinic_id" defaultValue={clinic.id} className="max-w-full rounded-lg border border-brand-900/15 bg-white px-3 py-2 text-sm sm:max-w-[440px]">
      {clinics.map((row) => <option key={row.id} value={row.id}>{row.name}{counts.get(row.name)! > 1 ? ` · ${formatDateTime(row.created_at, clinic.timezone)} · ${row.id.slice(0, 8)}` : ""}</option>)}
    </select>
    <button className="ml-2 rounded-lg bg-brand-950 px-3 py-2 text-sm text-white">Abrir clínica</button>
    <p className="mt-1 text-xs text-brand-900/60">Configuración, agenda, pacientes y conversaciones corresponden a esta clínica. Pedidos de demo y conexiones generales se administran por separado.</p>
  </form>;
}
