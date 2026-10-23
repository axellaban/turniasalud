import Link from "next/link";
import { sql } from "@/lib/db";
import { getPanelClinic, requireAdmin } from "@/lib/panel-clinic";
import type { Clinic } from "@/lib/types";
import { selectClinic } from "../../clinics-actions";
import { Badge, Card, Empty, PageHeader, buttonClass, inputClass, secondaryButtonClass } from "@/components/ui";
import { DeleteClinicButton, DeleteTemporaryDemosButton, NewClinicForm } from "./forms";
import { formatDateTime } from "@/lib/time";

const FILTERS = [
  { key: "", label: "Todas" },
  { key: "conservadas", label: "Conservadas" },
  { key: "temporales", label: "Temporales" },
] as const;

export default async function ClinicsPage({ searchParams }: PageProps<"/panel/clinicas">) {
  await requireAdmin();
  const active = await getPanelClinic();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 160) : "";
  const estado = FILTERS.find((f) => f.key === params.estado)?.key ?? "";
  const clinics = await sql<(Clinic & { accesses: number; last_actor: string | null; last_area: string | null; last_change: string | null })[]>`
    select c.*, (select count(*)::int from clinic_access a where a.clinic_id = c.id and a.revoked_at is null) as accesses,
      ch.actor as last_actor, ch.area as last_area, ch.created_at as last_change
    from clinics c
    left join lateral (select actor, area, created_at from clinic_changes where clinic_id = c.id order by created_at desc limit 1) ch on true
    where strpos(lower(concat_ws(' ', c.name, c.specialty, c.website)), lower(${q})) > 0
      ${estado === "conservadas" ? sql`and (not c.is_demo or c.retained_at is not null)` : estado === "temporales" ? sql`and c.is_demo and c.retained_at is null` : sql``}
    order by c.is_demo, c.updated_at desc, c.created_at desc limit 100`;
  const [{ temporary }] = await sql<{ temporary: number }[]>`select count(*)::int as temporary from clinics where is_demo and retained_at is null`;
  const filterHref = (key: string) => `/panel/clinicas?${new URLSearchParams({ ...(q ? { q } : {}), ...(key ? { estado: key } : {}) })}`;

  return <>
    <PageHeader title="Clínicas" description="Elegí una ficha para configurarla y probarla. Las demos temporales se borran solas a los 7 días." actions={<DeleteTemporaryDemosButton count={temporary} />} />
    <form className="mb-3 flex gap-2">
      {estado && <input type="hidden" name="estado" value={estado} />}
      <input aria-label="Buscar clínica" name="q" defaultValue={q} placeholder="Buscar por nombre, especialidad o web" className={inputClass} />
      <button className={buttonClass}>Buscar</button>
    </form>
    <div className="mb-4 flex flex-wrap gap-1.5">
      {FILTERS.map((f) => <Link key={f.key} href={filterHref(f.key)} aria-current={f.key === estado ? "page" : undefined} className={`rounded-full px-3 py-1 text-sm font-medium ${f.key === estado ? "bg-brand-600 text-white" : "text-brand-800 ring-1 ring-brand-200 hover:bg-brand-50"}`}>{f.label}</Link>)}
    </div>

    <Card className="mb-6 p-0">
      <ul className="divide-y divide-brand-900/5">
        {clinics.map((clinic) => <li key={clinic.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
          <div className="min-w-0 flex-1 basis-64">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold text-brand-950">{clinic.name}</h2>
              <Badge tone={clinic.retained_at || !clinic.is_demo ? "green" : "yellow"}>{!clinic.is_demo ? "Principal" : clinic.retained_at ? "Demo conservada" : "Demo temporal"}</Badge>
              {clinic.id === active.id && <Badge tone="blue">Seleccionada</Badge>}
              {clinic.accesses > 0 && <Badge tone="blue">Con acceso propio</Badge>}
            </div>
            <p className="mt-0.5 text-sm text-brand-900/60">{clinic.specialty}{clinic.website && <> · <a className="break-all text-brand-600 underline" href={clinic.website} target="_blank" rel="noreferrer">{clinic.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}</a></>}</p>
            <p className="mt-1 text-xs text-brand-900/50">Creada: {formatDateTime(clinic.created_at, clinic.timezone)} · Ref. {clinic.id.slice(0, 8)}</p>
            {clinic.last_change && <p className="mt-0.5 text-xs text-brand-900/60">Última edición: <span className={clinic.last_actor === "Turnia" ? "" : "font-semibold text-brand-700"}>{clinic.last_actor}</span> · {clinic.last_area} · {formatDateTime(clinic.last_change, clinic.timezone)}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <form action={selectClinic}><input type="hidden" name="clinic_id" value={clinic.id} /><button className={clinic.id === active.id ? secondaryButtonClass : buttonClass}>Abrir configuración</button></form>
            {clinic.is_demo && <DeleteClinicButton clinicId={clinic.id} name={clinic.name} />}
          </div>
        </li>)}
      </ul>
      {!clinics.length && <div className="p-5"><Empty>No hay clínicas con esta búsqueda.</Empty></div>}
    </Card>

    <Card>
      <details>
        <summary className="cursor-pointer font-semibold text-brand-950">+ Crear una clínica manualmente</summary>
        <div className="mt-4"><NewClinicForm /></div>
      </details>
    </Card>
  </>;
}
