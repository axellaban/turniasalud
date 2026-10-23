import { getPanelClinic } from "@/lib/panel-clinic";
import Link from "next/link";
import { sql } from "@/lib/db";
import { formatDate } from "@/lib/time";
import { displayPhone } from "@/lib/phone";
import { Card, Empty, PageHeader, inputClass, secondaryButtonClass } from "@/components/ui";
import type { Patient } from "@/lib/types";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Pacientes · Panel" };

export default async function PatientsPage({ searchParams }: PageProps<"/panel/pacientes">) {
  const clinic = await getPanelClinic();
  const { q } = await searchParams;
  const search = typeof q === "string" ? q.trim() : "";
  const pattern = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await sql<Patient[]>`
    select * from patients
    where clinic_id = ${clinic.id}
      ${search ? sql`and (full_name ilike ${pattern} or phone ilike ${pattern} or dni ilike ${pattern})` : sql``}
    order by last_contact_at desc nulls last, created_at desc
    limit 200`;

  return (
    <>
      <PageHeader title="Pacientes" description="Cada paciente con su memoria: cobertura, preferencias y lo que contó en conversaciones anteriores." />
      <form className="mb-5 flex max-w-md gap-2">
        <input name="q" defaultValue={search} placeholder="Buscar por nombre, celular o DNI" className={inputClass} />
        <button className={secondaryButtonClass}>Buscar</button>
      </form>
      {rows.length ? (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-brand-900/10 text-xs uppercase tracking-wider text-brand-900/50">
              <tr>
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
                  <td className="px-5 py-3">
                    <Link href={`/panel/pacientes/${p.id}`} className="font-medium text-brand-950 hover:underline">
                      {p.full_name ?? "Sin nombre"}
                    </Link>
                    {p.dni && <p className="text-xs text-brand-900/50">DNI {p.dni}</p>}
                  </td>
                  <td className="px-5 py-3 text-brand-900/70">{displayPhone(p.phone)}</td>
                  <td className="px-5 py-3 text-brand-900/70">
                    {p.coverage ?? "—"} {p.coverage_plan && <span className="text-brand-900/45">{p.coverage_plan}</span>}
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
        <Empty>{search ? "No encontramos pacientes con esa búsqueda." : "Todavía no hay pacientes."}</Empty>
      )}
    </>
  );
}
