import type { Metadata } from "next";
import { Card, Empty, Field, inputClass, smallButtonClass } from "@/components/ui";
import { getPanelClinic, requireAdmin } from "@/lib/panel-clinic";
import { formatDate } from "@/lib/time";
import { labCriteria } from "@/lib/lab/panel";
import { labAddCriterion, labCreateToken, labDeleteCriterion, labRevokeToken } from "../../../lab-actions";
import { sql } from "@/lib/db";
import { LabForm } from "../lab-form";
import { LabHeader } from "../lab-ui";

export const metadata: Metadata = { title: "Criterios · Laboratorio de Sofi" };

export default async function CriteriaPage() {
  await requireAdmin();
  const clinic = await getPanelClinic();
  const [criteria, tokens] = await Promise.all([
    labCriteria(clinic.id),
    sql<Array<{ id: string; label: string; scope: string; created_at: string; last_used_at: string | null }>>`
      select id, label, scope, created_at, last_used_at from lab_access_tokens where revoked_at is null order by created_at desc`,
  ]);
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

      <Card className="mt-5">
        <h2 className="font-semibold text-brand-950">Acceso de Claude Code o ChatGPT</h2>
        <p className="mt-1 max-w-prose text-sm text-brand-900/70">
          No hace falta para evaluar: eso se hace en la pestaña Evaluar, sin claves. Esto es solo para quien quiera que Claude Code lo haga solo: una clave <strong>para evaluar</strong> (skill <code>laboratorio-sofi</code>) o <strong>de solo lectura</strong> para mirar el informe. Ninguna puede reservar ni tocar pacientes. Se ve una sola vez: guardala en el entorno de la sesión (Network secrets, host <code>turniasalud.app</code>, header <code>x-lab-token</code>) o en tu computadora como <code>LAB_TOKEN</code>, nunca en el chat.
        </p>
        {tokens.length > 0 && (
          <ul className="mt-3 divide-y divide-brand-900/10 text-sm">
            {tokens.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{t.label} · {t.scope === "evaluar" ? "para evaluar" : "solo lectura"}<span className="block text-xs text-brand-900/60">Creada el {formatDate(t.created_at, clinic.timezone)} · {t.last_used_at ? `usada el ${formatDate(t.last_used_at, clinic.timezone)}` : "sin usar"}</span></span>
                <LabForm action={labRevokeToken} submit="Revocar" button={smallButtonClass} confirm="¿Revocar esta clave?">
                  <input type="hidden" name="clave" value={t.id} />
                </LabForm>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <LabForm action={labCreateToken} submit="Crear clave para evaluar" className="space-y-2">
            <input type="hidden" name="etiqueta" value="Claude Code o ChatGPT (evaluar)" />
            <input type="hidden" name="permiso" value="evaluar" />
          </LabForm>
          <LabForm action={labCreateToken} submit="Crear clave de solo lectura" button={smallButtonClass} className="space-y-2">
            <input type="hidden" name="etiqueta" value="Claude Code (lectura)" />
          </LabForm>
        </div>
      </Card>
    </>
  );
}
