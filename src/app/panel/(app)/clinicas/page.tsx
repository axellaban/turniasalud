import { sql } from "@/lib/db";
import { getPanelClinic } from "@/lib/panel-clinic";
import type { Clinic } from "@/lib/types";
import { selectClinic } from "../../clinics-actions";
import { Badge, Card, Empty, PageHeader, buttonClass, inputClass } from "@/components/ui";
import { DeleteClinicButton, DeleteTemporaryDemosButton, NewClinicForm } from "./forms";
import { formatDateTime } from "@/lib/time";

export default async function ClinicsPage({ searchParams }: PageProps<"/panel/clinicas">) {
  const active = await getPanelClinic();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 160) : "";
  const clinics = await sql<Clinic[]>`select * from clinics where strpos(lower(concat_ws(' ', name, specialty, website)), lower(${q})) > 0 order by is_demo, updated_at desc, created_at desc limit 100`;
  const [{ temporary }] = await sql<{ temporary: number }[]>`select count(*)::int as temporary from clinics where is_demo and retained_at is null`;
  return <>
    <PageHeader title="Clínicas" description="Elegí una ficha, completá el contexto del agente y probala con tus cambios." />
    <form className="mb-5 flex gap-2"><input aria-label="Buscar clínica" name="q" defaultValue={q} placeholder="Nombre, especialidad o web" className={inputClass} /><button className={buttonClass}>Buscar</button></form>
    <div className="mb-5 flex flex-wrap items-center gap-3"><DeleteTemporaryDemosButton count={temporary} /><p className="text-xs text-brand-900/60">Las demos temporales igual se borran solas a los 7 días.</p></div>
    <div className="mb-6 grid gap-4 lg:grid-cols-2">{clinics.map((clinic) => <Card key={clinic.id}>
      <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold text-brand-950">{clinic.name}</h2>{clinic.id === active.id && <Badge tone="blue">Seleccionada</Badge>}</div>
      <p className="mt-1 text-sm text-brand-900/60">{clinic.specialty}</p>
      <p className="mt-2 text-sm"><Badge tone={clinic.retained_at || !clinic.is_demo ? "green" : "yellow"}>{!clinic.is_demo ? "Principal" : clinic.retained_at ? "Demo conservada" : "Demo temporal"}</Badge></p>
      {clinic.website && <a className="mt-3 block break-all text-sm text-brand-600 underline" href={clinic.website} target="_blank" rel="noreferrer">{clinic.website}</a>}
      <p className="mt-3 text-xs text-brand-900/50">Creada: {formatDateTime(clinic.created_at, clinic.timezone)} · Ref. {clinic.id.slice(0, 8)}</p>
      <p className="mb-3 mt-1 text-xs text-brand-900/50">Actualizada: {formatDateTime(clinic.updated_at, clinic.timezone)}</p>
      <div className="flex flex-wrap gap-2">
        <form action={selectClinic}><input type="hidden" name="clinic_id" value={clinic.id} /><button className={buttonClass}>Abrir configuración</button></form>
        {clinic.is_demo && <DeleteClinicButton clinicId={clinic.id} name={clinic.name} />}
      </div>
    </Card>)}{!clinics.length && <Empty>No hay clínicas con esta búsqueda.</Empty>}</div>
    <Card><h2 className="mb-4 font-semibold text-brand-950">Crear una clínica manualmente</h2><NewClinicForm /></Card>
  </>;
}
