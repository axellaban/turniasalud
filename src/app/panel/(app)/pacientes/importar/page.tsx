import { getPanelClinic } from "@/lib/panel-clinic";
import Link from "next/link";
import { sql } from "@/lib/db";
import { formatDateTime } from "@/lib/time";
import { Card, PageHeader, smallButtonClass } from "@/components/ui";
import { undoImportAction } from "../../../campaign-actions";
import { ImportForm } from "./import-form";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Importar pacientes · Panel" };

const COLUMNS: Array<[string, string]> = [
  ["Nombre y celular", "Obligatorios. El celular con código de área (11, 351…)."],
  ["Fecha de la última visita", "Con esto encontramos a los inactivos. Si pegás una fila por visita, se guardan todas."],
  ["Prestación o tratamiento", "Si coincide con una prestación tuya que tiene control periódico, entra en «Controles vencidos»."],
  ["Próximo control", "Una fecha indicada por el profesional: ese día el paciente aparece para escribirle."],
  ["Opcionales", "DNI, email, obra social, plan, afiliado, nacimiento, profesional y notas."],
];

export default async function ImportPatientsPage() {
  const clinic = await getPanelClinic();
  const imports = await sql<
    Array<{ id: string; source: string | null; actor: string; created_patients: number; updated_patients: number; visits: number; skipped: number; created_at: string; undone_at: string | null }>
  >`
    select id, source, actor, created_patients, updated_patients, visits, skipped, created_at, undone_at
    from patient_imports where clinic_id = ${clinic.id} order by created_at desc limit 10`;

  return (
    <>
      <Link href="/panel/pacientes" className="text-sm text-brand-700 hover:underline">
        ← Pacientes
      </Link>
      <PageHeader
        title="Importar pacientes"
        description="Traé la base que tenés en tu sistema de turnos o en una planilla. Con las fechas de visita, Campañas te muestra a quiénes les toca volver."
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card className="min-w-0">
          <ImportForm clinicId={clinic.id} />
        </Card>
        <aside className="space-y-6">
          <Card>
            <h2 className="font-semibold text-brand-950">Qué columnas sirven</h2>
            <dl className="mt-3 space-y-3 text-sm">
              {COLUMNS.map(([title, text]) => (
                <div key={title}>
                  <dt className="font-medium text-brand-950">{title}</dt>
                  <dd className="text-brand-900/65">{text}</dd>
                </div>
              ))}
            </dl>
            <a href="/plantilla-pacientes.csv" download className={`${smallButtonClass} mt-4 inline-flex`}>
              Bajar una planilla de ejemplo
            </a>
          </Card>
          <Card className="bg-brand-50/60">
            <h2 className="font-semibold text-brand-950">De dónde sacarla</h2>
            <p className="mt-1 text-sm text-brand-900/70">
              Casi todos los sistemas de turnos e historias clínicas permiten exportar pacientes o turnos atendidos a Excel o CSV (buscá «Exportar» o
              «Reportes»). Si llevás la agenda en papel o en un Excel propio, alcanza con nombre, celular y la fecha de la última visita.
            </p>
            <p className="mt-2 text-sm text-brand-900/70">
              Si un paciente ya estaba, solo completamos los datos que le faltaban. Quien pidió la baja sigue sin recibir campañas.
            </p>
          </Card>
          {imports.length > 0 && (
            <Card>
              <h2 className="font-semibold text-brand-950">Importaciones</h2>
              <ul className="mt-3 divide-y divide-brand-900/5 text-sm">
                {imports.map((i) => (
                  <li key={i.id} className="py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-brand-950">{i.source ?? "Planilla"}</p>
                        <p className="text-xs text-brand-900/60">
                          {formatDateTime(i.created_at, clinic.timezone)} · {i.actor}
                        </p>
                      </div>
                      {i.undone_at ? (
                        <span className="shrink-0 text-xs text-brand-900/60">Deshecha</span>
                      ) : (
                        <form action={undoImportAction}>
                          <input type="hidden" name="clinic_id" value={clinic.id} />
                          <input type="hidden" name="id" value={i.id} />
                          <button className={smallButtonClass}>Deshacer</button>
                        </form>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-brand-900/70">
                      {i.created_patients} nuevos · {i.updated_patients} ya estaban · {i.visits} visitas{i.skipped ? ` · ${i.skipped} filas salteadas` : ""}
                    </p>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-brand-900/60">
                Deshacer borra las visitas importadas y las fichas nuevas que todavía no tuvieron turnos, charlas ni mensajes.
              </p>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
