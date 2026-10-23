import { sql } from "@/lib/db";
import { getPanelClinic, getPanelUser } from "@/lib/panel-clinic";
import { formatDateTime } from "@/lib/time";
import { Badge } from "@/components/ui";
import { ClinicSelect } from "./clinic-select";

export async function ClinicSwitcher() {
  const [user, clinic] = await Promise.all([getPanelUser(), getPanelClinic()]);
  const tag = !clinic.is_demo ? null : <Badge tone={clinic.retained_at ? "green" : "yellow"}>{clinic.retained_at ? "Demo conservada" : "Demo temporal"}</Badge>;
  // El consultorio ve solo su nombre: «demo conservada» es un estado interno de Turnia.
  if (user.role !== "admin") {
    return <div className="flex min-w-0 flex-1 items-center gap-2"><p className="truncate text-sm font-semibold text-brand-950">{clinic.name}</p></div>;
  }
  const clinics = await sql<{ id: string; name: string; created_at: string; is_demo: boolean }[]>`select id, name, created_at, is_demo from clinics order by is_demo, name, created_at desc`;
  const counts = new Map<string, number>();
  for (const row of clinics) counts.set(row.name, (counts.get(row.name) ?? 0) + 1);
  const options = clinics.map((row) => ({
    id: row.id,
    label: `${row.name}${!row.is_demo ? " · principal" : ""}${counts.get(row.name)! > 1 ? ` · ${formatDateTime(row.created_at, clinic.timezone)} · ${row.id.slice(0, 8)}` : ""}`,
  }));
  return <div className="flex min-w-0 flex-1 items-center gap-2"><ClinicSelect current={clinic.id} options={options} /><span className="hidden lg:inline-flex">{tag}</span></div>;
}
