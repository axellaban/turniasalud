import Link from "next/link";
import type { Metadata } from "next";
import { Badge, Card, Empty, Notice, smallButtonClass } from "@/components/ui";
import { getPanelClinic, requireAdmin } from "@/lib/panel-clinic";
import { formatDateTime } from "@/lib/time";
import { INTENT_LABEL, SITUATION_LABEL, labReviews } from "@/lib/lab/panel";
import { labCaseFromConversation } from "../../../lab-actions";
import { LabForm } from "../lab-form";
import { Findings, LabHeader, fmtScore, scoreTone } from "../lab-ui";

export const metadata: Metadata = { title: "Charlas · Laboratorio de Sofi" };
export const maxDuration = 300;

const FILTERS = [
  { id: "todas", label: "Todas" },
  { id: "reales", label: "Reales" },
  { id: "pruebas", label: "Pruebas en producción" },
  { id: "bajas", label: "Menos de 70" },
] as const;

export default async function ReviewsPage({ searchParams }: PageProps<"/panel/laboratorio/charlas">) {
  await requireAdmin();
  const clinic = await getPanelClinic();
  const { filtro } = (await searchParams) as { filtro?: string };
  const filter = FILTERS.find((f) => f.id === filtro)?.id ?? "todas";
  const rows = await labReviews(clinic.id, filter);
  return (
    <>
      <LabHeader
        current="/panel/laboratorio/charlas"
        title="Charlas puntuadas"
        description={`Las charlas reales de ${clinic.name} (y las de los testers en modo prueba), puntuadas con la misma rúbrica que el laboratorio. Se revisan solas a la media hora de cerrarse.`}
      />
      {!clinic.lab_enabled && <Notice tone="warning" className="mb-5">El laboratorio está apagado para este consultorio: las charlas nuevas no se revisan. Se prende en Resumen.</Notice>}
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.id}
            href={`/panel/laboratorio/charlas?filtro=${f.id}`}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${f.id === filter ? "bg-brand-600 text-white" : "text-brand-800 ring-1 ring-brand-200 hover:bg-brand-50"}`}
          >
            {f.label}
          </Link>
        ))}
      </div>
      {rows.length ? (
        <div className="space-y-3">
          {rows.map((r) => (
            <Card key={r.conversation_id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {r.is_test && <Badge tone="blue">Prueba</Badge>}
                    {r.critical && <Badge tone="red">Falla crítica</Badge>}
                    <span className="text-sm font-medium text-brand-950">
                      {r.intent ? INTENT_LABEL[r.intent] ?? r.intent : "Sin clasificar"}
                      {r.situation ? ` · ${SITUATION_LABEL[r.situation] ?? r.situation}` : ""}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-brand-900/60">{formatDateTime(r.started_at, clinic.timezone)} · {r.channel}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Link href={`/panel/conversaciones/${r.conversation_id}`} className={smallButtonClass}>Ver charla</Link>
                  <span className="grid h-9 min-w-11 place-items-center rounded-lg px-2 text-sm font-semibold" style={{ background: `${scoreTone(r.score)}22` }}>
                    {r.error ? "—" : fmtScore(r.score)}
                  </span>
                </div>
              </div>
              {r.error && <p className="mt-2 text-sm text-brand-900/70">{r.error === "en revisión" ? "En revisión…" : `No se pudo revisar: ${r.error}`}</p>}
              {r.summary && <p className="mt-2 text-sm text-brand-900/80">{r.summary}</p>}
              {r.findings?.length ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm font-medium text-brand-700">{r.findings.length} problema{r.findings.length === 1 ? "" : "s"}</summary>
                  <div className="mt-2"><Findings items={r.findings} /></div>
                </details>
              ) : null}
              {!r.error && (
                <LabForm action={labCaseFromConversation} submit="Convertir en caso de la batería" pending="Claude está armando el caso…" button={`${smallButtonClass} mt-3`}>
                  <input type="hidden" name="conversacion" value={r.conversation_id} />
                </LabForm>
              )}
            </Card>
          ))}
        </div>
      ) : (
        <Empty>Todavía no hay charlas puntuadas con este filtro.</Empty>
      )}
    </>
  );
}
