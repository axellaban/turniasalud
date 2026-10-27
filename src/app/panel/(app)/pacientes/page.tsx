import { getPanelClinic, getPanelUser } from "@/lib/panel-clinic";
import Link from "next/link";
import { sql } from "@/lib/db";
import { deletePatientsAction } from "../../actions";
import { formatDate } from "@/lib/time";
import { displayPhone } from "@/lib/phone";
import { Card, Empty, Notice, PageHeader, buttonClass, inputClass, secondaryButtonClass } from "@/components/ui";
import { DeleteSelectedPatients, SelectAllPatients } from "./delete-patients";
import type { Patient } from "@/lib/types";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Pacientes · Panel" };

const DELETE_FORM = "borrar-fichas";

export default async function PatientsPage({ searchParams }: PageProps<"/panel/pacientes">) {
  const clinic = await getPanelClinic();
  // Borrar fichas: solo el administrador (el acceso del consultorio no puede).
  const canDelete = (await getPanelUser()).role === "admin";
  const { q, borradas, eventos } = await searchParams;
  const deleted = typeof borradas === "string" ? Number(borradas) : 0;
  const eventsLeft = typeof eventos === "string" ? Number(eventos) : 0;
  const search = typeof q === "string" ? q.trim() : "";
  const pattern = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await sql<Array<Patient & { same_dni: number }>>`
    select p.*,
      (select count(*) from patients d where d.clinic_id = p.clinic_id and d.dni = p.dni)::int as same_dni
    from patients p
    where clinic_id = ${clinic.id}
      ${search ? sql`and (full_name ilike ${pattern} or phone ilike ${pattern} or dni ilike ${pattern})` : sql``}
    order by last_contact_at desc nulls last, created_at desc
    limit 200`;

  return (
    <>
      <PageHeader
        title="Pacientes"
        description="Cada paciente con su memoria: cobertura, preferencias y lo que contó en conversaciones anteriores."
        actions={
          <Link href="/panel/pacientes/importar" className={buttonClass}>
            Importar pacientes
          </Link>
        }
      />
      {deleted > 0 && (
        <Notice tone="success" className="mb-4">
          {deleted === 1 ? "Se borró 1 ficha" : `Se borraron ${deleted} fichas`} con sus turnos, conversaciones y pedidos.
          {eventsLeft > 0 && ` ${eventsLeft === 1 ? "Un evento" : `${eventsLeft} eventos`} de Google Calendar no se pudieron sacar: borralos a mano en el calendario del profesional.`}
        </Notice>
      )}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <form className="flex w-full max-w-md gap-2">
          <input name="q" defaultValue={search} placeholder="Buscar por nombre, celular o DNI" className={inputClass} />
          <button className={secondaryButtonClass}>Buscar</button>
        </form>
        {canDelete && rows.length > 0 && <DeleteSelectedPatients formId={DELETE_FORM} />}
      </div>
      {canDelete && (
        <form id={DELETE_FORM} action={deletePatientsAction}>
          <input type="hidden" name="clinic_id" value={clinic.id} />
        </form>
      )}
      {rows.length ? (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-brand-900/10 text-xs uppercase tracking-wider text-brand-900/65">
              <tr>
                {canDelete && (
                  <th className="w-10 py-3 pl-5">
                    <SelectAllPatients formId={DELETE_FORM} />
                  </th>
                )}
                <th className="px-5 py-3 font-medium">Paciente</th>
                <th className="px-5 py-3 font-medium">Celular</th>
                <th className="px-5 py-3 font-medium">Cobertura</th>
                <th className="px-5 py-3 font-medium">Memoria</th>
                <th className="px-5 py-3 font-medium">Último contacto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-900/5">
              {rows.map((p) => (
                <tr key={p.id} className="hover:bg-brand-50/50">
                  {canDelete && (
                    <td className="w-10 py-3 pl-5">
                      <input
                        type="checkbox"
                        name="ids"
                        value={p.id}
                        form={DELETE_FORM}
                        aria-label={`Seleccionar ${p.full_name ?? "paciente sin nombre"}`}
                        className="size-4 accent-brand-600"
                      />
                    </td>
                  )}
                  <td className="px-5 py-3">
                    <Link href={`/panel/pacientes/${p.id}`} className="font-medium text-brand-950 hover:underline">
                      {p.full_name ?? "Sin nombre"}
                    </Link>
                    {p.dni && (
                      <p className="text-xs text-brand-900/65">
                        DNI {p.dni}
                        {p.same_dni > 1 && <span className="ml-1.5 font-medium text-sun-700">· {p.same_dni} fichas con este DNI</span>}
                      </p>
                    )}
                  </td>
                  <td className="px-5 py-3 text-brand-900/70">{displayPhone(p.phone)}</td>
                  <td className="px-5 py-3 text-brand-900/70">
                    {p.coverage ?? "—"} {p.coverage_plan && <span className="text-brand-900/65">{p.coverage_plan}</span>}
                  </td>
                  <td className="max-w-xs px-5 py-3 text-xs text-brand-900/60">
                    <span className="line-clamp-2">{p.memory_summary ?? "—"}</span>
                  </td>
                  <td className="px-5 py-3 text-brand-900/60">{p.last_contact_at ? formatDate(p.last_contact_at, clinic.timezone) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <Empty>
          {search ? (
            "No encontramos pacientes con esa búsqueda."
          ) : (
            <>
              Todavía no hay pacientes.{" "}
              <Link href="/panel/pacientes/importar" className="font-medium text-brand-700 underline">
                Importá los de tu sistema o tu Excel
              </Link>
              .
            </>
          )}
        </Empty>
      )}
    </>
  );
}
