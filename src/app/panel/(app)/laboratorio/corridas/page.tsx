import type { Metadata } from "next";
import { Badge, Card, Empty } from "@/components/ui";
import { getPanelClinic, requireAdmin } from "@/lib/panel-clinic";
import { formatDateTime } from "@/lib/time";
import { labRuns } from "@/lib/lab/panel";
import { KIND_LABEL, LabHeader, RUN_STATUS, RunLink, fmtScore, modelLabel } from "../lab-ui";

export const metadata: Metadata = { title: "Corridas · Laboratorio de Sofi" };

export default async function RunsPage() {
  await requireAdmin();
  const clinic = await getPanelClinic();
  const runs = await labRuns(clinic.id);
  return (
    <>
      <LabHeader current="/panel/laboratorio/corridas" title="Corridas" description="Cada batería, experimento y prueba de «Jugar de paciente», con su puntaje." />
      {runs.length ? (
        <Card className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-brand-900/65">
                <tr>
                  <th className="px-5 py-3 font-medium">Corrida</th>
                  <th className="px-3 py-3 font-medium">Tipo</th>
                  <th className="px-3 py-3 font-medium">Estado</th>
                  <th className="px-3 py-3 font-medium">Puntaje</th>
                  <th className="px-5 py-3 font-medium">Cuándo</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-t border-brand-900/10">
                    <td className="px-5 py-3"><RunLink id={r.id}>{r.label}</RunLink><span className="block text-xs text-brand-900/60">{r.cases.length} casos × {r.repeat_count} · {modelLabel(r.agent_llm)}</span></td>
                    <td className="px-3 py-3">{KIND_LABEL[r.kind]}</td>
                    <td className="px-3 py-3"><Badge tone={RUN_STATUS[r.status]?.tone}>{RUN_STATUS[r.status]?.label}</Badge></td>
                    <td className="px-3 py-3 font-semibold">{fmtScore(r.score)}{r.critical_count > 0 && <span className="ml-1 text-xs font-normal text-red-700">· {r.critical_count} crítica{r.critical_count === 1 ? "" : "s"}</span>}</td>
                    <td className="px-5 py-3 text-brand-900/70">{formatDateTime(r.created_at, clinic.timezone)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Empty>Todavía no hay corridas. La primera batería corre esta noche, o la podés correr ahora desde Resumen.</Empty>
      )}
    </>
  );
}
