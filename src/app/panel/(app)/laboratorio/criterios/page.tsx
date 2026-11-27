import type { Metadata } from "next";
import { Card, Empty, Field, inputClass, smallButtonClass } from "@/components/ui";
import { getPanelClinic, requireAdmin } from "@/lib/panel-clinic";
import { formatDate } from "@/lib/time";
import { labCriteria } from "@/lib/lab/panel";
import { labAddCriterion, labDeleteCriterion } from "../../../lab-actions";
import { LabForm } from "../lab-form";
import { LabHeader } from "../lab-ui";

export const metadata: Metadata = { title: "Criterios · Laboratorio de Sofi" };

export default async function CriteriaPage() {
  await requireAdmin();
  const clinic = await getPanelClinic();
  const criteria = await labCriteria(clinic.id);
  return (
    <>
      <LabHeader
        current="/panel/laboratorio/criterios"
        title="Criterios"
        description="Lo que el equipo ya decidió. El juez lo usa al puntuar y Claude lo lee antes de proponer, para no volver a sugerir lo mismo. Cada mejora rechazada suma uno."
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        {criteria.length ? (
          <Card className="p-0">
            <ul className="divide-y divide-brand-900/10">
              {criteria.map((c) => (
                <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3 text-sm">
                  <span className="min-w-0 flex-1">
                    {c.text}
                    <span className="mt-0.5 block text-xs text-brand-900/60">
                      {c.clinic_id ? clinic.name : "Todas las clínicas"} · {c.created_by ?? "—"} · {formatDate(c.created_at, clinic.timezone)}
                    </span>
                  </span>
                  <LabForm action={labDeleteCriterion} submit="Borrar" button={smallButtonClass} confirm="¿Borrar este criterio?">
                    <input type="hidden" name="criterio" value={c.id} />
                  </LabForm>
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <Empty>Todavía no hay criterios. Se suman al rechazar una mejora o desde acá.</Empty>
        )}
        <Card className="self-start">
          <h2 className="font-semibold text-brand-950">Sumar un criterio</h2>
          <LabForm action={labAddCriterion} submit="Guardar" className="mt-3 space-y-3">
            <Field label="Criterio" hint="Una regla clara, con su motivo si hace falta.">
              <textarea name="criterio" rows={3} className={inputClass} placeholder={`Ej.: En ${clinic.name}, si el paciente no pide un profesional, se ofrece primero al dueño del consultorio; no se pregunta por profesional al inicio.`} required />
            </Field>
            <Field label="Para">
              <select name="alcance" className={inputClass} defaultValue="clinica">
                <option value="clinica">{clinic.name}</option>
                <option value="todas">Todas las clínicas</option>
              </select>
            </Field>
          </LabForm>
        </Card>
      </div>
    </>
  );
}
