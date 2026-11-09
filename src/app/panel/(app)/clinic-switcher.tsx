import { getPanelClinic, getPanelUser } from "@/lib/panel-clinic";
import { Badge } from "@/components/ui";
import { clinicOptions } from "@/lib/clinic-options";
import { clinicRows } from "@/lib/sales/outreach";
import { ClinicSelect } from "./clinic-select";

export async function ClinicSwitcher() {
  const [user, clinic] = await Promise.all([getPanelUser(), getPanelClinic()]);
  const tag = !clinic.is_demo ? null : <Badge tone={clinic.retained_at ? "green" : "yellow"}>{clinic.retained_at ? "Demo conservada" : "Demo temporal"}</Badge>;
  // El consultorio ve solo su nombre: «demo conservada» es un estado interno de Turnia.
  if (user.role !== "admin") {
    return <div className="flex min-w-0 flex-1 items-center gap-2"><p className="truncate text-sm font-semibold text-brand-950">{clinic.name}</p></div>;
  }
  const rows = await clinicRows();
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <ClinicSelect current={clinic.id} options={clinicOptions(rows, clinic.id, clinic.timezone)} />
      <span className="hidden lg:inline-flex">{tag}</span>
    </div>
  );
}
