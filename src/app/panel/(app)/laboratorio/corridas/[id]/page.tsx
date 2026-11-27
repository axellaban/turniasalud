import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Badge, Card, Notice, ghostButtonClass, secondaryButtonClass, smallButtonClass } from "@/components/ui";
import { isUuid } from "@/lib/clinic";
import { getPanelClinic, requireAdmin } from "@/lib/panel-clinic";
import { formatDateTime } from "@/lib/time";
import { INTENT_LABEL, SITUATION_LABEL, num } from "@/lib/lab/panel";
import { getRun, runResults } from "@/lib/lab/runs";
import { normalizeTranscript } from "@/lib/lab/transcript";
import { labAdvance, labProposeFromResult, labSaveCase } from "../../../../lab-actions";
import { LabForm } from "../../lab-form";
import { BandBadge, DimBars, Findings, KIND_LABEL, LabHeader, RUN_STATUS, ScoreRing, Transcript, Verdicts, fmtScore, scoreTone } from "../../lab-ui";

export const metadata: Metadata = { title: "Corrida · Laboratorio de Sofi" };
export const maxDuration = 300;

export default async function RunPage({ params, searchParams }: PageProps<"/panel/laboratorio/corridas/[id]">) {
  await requireAdmin();
  const { id } = await params;
  const { caso } = (await searchParams) as { caso?: string };
  const clinic = await getPanelClinic();
  const run = isUuid(id) ? await getRun(id) : null;
  if (!run || run.clinic_id !== clinic.id) notFound();
  const results = await runResults(run.id);
  const open = ["preparando", "corriendo", "puntuando"].includes(run.status);
  const byCase = run.cases.map((c) => {
    const rows = results.filter((r) => r.case_id === c.id);
    const scores = rows.map((r) => num(r.score)).filter((s): s is number => s !== null);
    return { c, rows, score: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null, critical: rows.some((r) => r.critical) };
  });
  const selected = byCase.find((x) => x.c.id === caso) ?? (byCase.length === 1 ? byCase[0] : null);
  const judgedCount = results.filter((r) => r.judged).length;

  return (
    <>
      <LabHeader
        current="/panel/laboratorio/corridas"
        title={run.label}
        description={`${KIND_LABEL[run.kind]} · ${run.cases.length} caso${run.cases.length === 1 ? "" : "s"} × ${run.repeat_count} · empezó el ${formatDateTime(run.created_at, clinic.timezone)}${run.created_by ? ` · ${run.created_by}` : ""}`}
        actions={<Badge tone={RUN_STATUS[run.status]?.tone}>{RUN_STATUS[run.status]?.label}</Badge>}
      />
      {run.error && <Notice tone="error" className="mb-5">{run.error}</Notice>}
      {open && (
        <Card className="mb-5">
          <LabForm action={labAdvance} submit="Actualizar ahora" pending="Trayendo y puntuando…" button={secondaryButtonClass} className="flex flex-wrap items-center justify-between gap-3">
            <input type="hidden" name="corrida" value={run.id} />
            <p className="text-sm text-brand-900/75">
              {run.status === "corriendo"
                ? "ElevenLabs está simulando las charlas (suele tardar entre 5 y 30 minutos según la cantidad)."
                : run.status === "puntuando"
                  ? `El juez va ${judgedCount} de ${results.length} charlas.`
                  : "Preparando las simulaciones."}{" "}
              Se avanza sola cada 10 minutos; con el botón, ahora.
            </p>
          </LabForm>
        </Card>
      )}

      {run.status === "terminada" && (
        <div className="mb-5 grid gap-5 lg:grid-cols-2">
          <Card>
            <div className="flex flex-wrap items-center gap-6">
              <ScoreRing score={run.score} size={128} />
              <div className="space-y-1.5 text-sm">
                <BandBadge score={run.score} />
                {num(run.spread) !== null && <p className="text-brand-900/70">±{fmtScore(run.spread)} entre repeticiones</p>}
                {run.critical_count > 0 && <p className="text-red-700">{run.critical_count} charla{run.critical_count === 1 ? "" : "s"} con falla crítica</p>}
                {run.proposal_id && <p><Link href={`/panel/laboratorio/experimentos?id=${run.id}`} className="font-medium text-brand-700 hover:underline">Ver el experimento</Link></p>}
              </div>
            </div>
          </Card>
          <Card>
            <DimBars dims={run.dims} showHelp={false} />
          </Card>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <Card className="self-start p-2">
          <ul className="space-y-1">
            {byCase.map(({ c, rows, score, critical }) => {
              const active = selected?.c.id === c.id;
              return (
                <li key={c.id}>
                  <Link
                    href={`/panel/laboratorio/corridas/${run.id}?caso=${encodeURIComponent(c.id)}`}
                    className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm ${active ? "bg-brand-50 ring-1 ring-brand-200" : "hover:bg-brand-50/60"}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-brand-950">{c.titulo}</span>
                      <span className="block text-xs text-brand-900/60">{INTENT_LABEL[c.intent] ?? c.intent} · {SITUATION_LABEL[c.situation] ?? c.situation}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {critical && <span className="text-xs font-semibold text-red-700">crítica</span>}
                      <span className="grid h-8 min-w-10 place-items-center rounded-lg px-1.5 text-sm font-semibold" style={{ background: `${scoreTone(score)}22`, color: score === null ? "#5b6275" : "#171729" }}>
                        {rows.length ? fmtScore(score) : "…"}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>

        <div className="min-w-0 space-y-5">
          {!selected ? (
            <Card><p className="text-sm text-brand-900/70">Elegí un caso para ver sus charlas, qué buscó Sofi y por qué sacó ese puntaje.</p></Card>
          ) : (
            <>
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-brand-950">{selected.c.titulo}</h2>
                    <p className="mt-1 max-w-prose text-sm text-brand-900/70">{selected.c.scenario}</p>
                  </div>
                  {run.kind === "jugar" && selected.c.id.startsWith("caso-") && (
                    <LabForm action={labSaveCase} submit="Guardar como caso de la batería" pending="Guardando…" button={smallButtonClass}>
                      <input type="hidden" name="corrida" value={run.id} />
                      <input type="hidden" name="caso" value={selected.c.id} />
                    </LabForm>
                  )}
                </div>
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer font-medium text-brand-700">Condiciones del caso ({selected.c.conditions.length})</summary>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-brand-900/80">
                    {selected.c.conditions.map((cond, i) => <li key={i}>{cond.text}{cond.critical ? " (crítica)" : ""}</li>)}
                  </ul>
                </details>
              </Card>
              {!selected.rows.length && <Card><p className="text-sm text-brand-900/70">Todavía no hay charlas de este caso.</p></Card>}
              {selected.rows.map((r) => (
                <Card key={r.id}>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-medium uppercase tracking-wider text-brand-900/65">Repetición {r.repetition}</p>
                    <div className="flex items-center gap-2">
                      {r.critical && <Badge tone="red">Falla crítica</Badge>}
                      <span className="rounded-lg px-2 py-1 text-sm font-semibold" style={{ background: `${scoreTone(r.score)}22` }}>
                        {r.judged ? (num(r.score) === null ? "Sin puntaje" : `Puntaje ${fmtScore(r.score)}`) : "Puntuando…"}
                      </span>
                    </div>
                  </div>
                  {r.error && <Notice tone={r.judged ? "error" : "warning"} className="mb-3">{r.error}</Notice>}
                  {r.summary && <p className="mb-3 text-sm text-brand-900/80">{r.summary}</p>}
                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
                    <Transcript lines={r.transcript} history={normalizeTranscript(selected.c.history)} />
                    <div className="space-y-4">
                      <Verdicts items={[...(r.conditions ?? []), ...(r.checks ?? [])]} />
                      <Findings items={r.findings} />
                      {r.judged && (num(r.score) ?? 100) < 90 && (
                        <LabForm action={labProposeFromResult} submit="Proponer una mejora" pending="Claude está pensando…" button={ghostButtonClass}>
                          <input type="hidden" name="resultado" value={r.id} />
                        </LabForm>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </>
          )}
        </div>
      </div>
    </>
  );
}
