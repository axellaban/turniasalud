import Link from "next/link";
import type { Metadata } from "next";
import { Badge, Card, Empty } from "@/components/ui";
import { getPanelClinic, requireAdmin } from "@/lib/panel-clinic";
import { formatDateTime } from "@/lib/time";
import { labRuns, num } from "@/lib/lab/panel";
import { experimentSummary } from "@/lib/lab/proposals";
import { runResults } from "@/lib/lab/runs";
import { DimBars, LabHeader, RUN_STATUS, RunLink, Transcript, fmtScore } from "../lab-ui";

export const metadata: Metadata = { title: "Experimentos · Laboratorio de Sofi" };

export default async function ExperimentsPage({ searchParams }: PageProps<"/panel/laboratorio/experimentos">) {
  await requireAdmin();
  const clinic = await getPanelClinic();
  const { id, caso } = (await searchParams) as { id?: string; caso?: string };
  // Las corridas «Referencia» (la versión actual con los mismos casos) se ven dentro de su experimento.
  const runs = (await labRuns(clinic.id, "experimento")).filter((r) => r.proposal_id);
  const selected = runs.find((r) => r.id === id) ?? runs[0] ?? null;
  const summary = selected ? await experimentSummary(selected.id) : null;
  const comparison = summary?.comparison ?? null;
  const pickedCase = comparison ? (comparison.cases.find((c) => c.case_id === caso) ?? comparison.cases.find((c) => (c.delta ?? 0) !== 0) ?? comparison.cases[0]) : null;
  const [baseRows, variantRows] = summary?.ready && pickedCase && summary.base && summary.variant
    ? await Promise.all([runResults(summary.base.id), runResults(summary.variant.id)])
    : [[], []];
  const titleOf = (caseId: string) => selected?.cases.find((c) => c.id === caseId)?.titulo ?? caseId;

  return (
    <>
      <LabHeader
        current="/panel/laboratorio/experimentos"
        title="Experimentos"
        description="Cada mejora de prompt se prueba antes de decidir: la versión actual contra la variante, con los mismos casos y 3 repeticiones de cada una."
      />
      {!runs.length || !selected ? (
        <Empty>Todavía no hay experimentos. Se arman solos con cada mejora de prompt, o desde Mejoras → «Probar en el laboratorio».</Empty>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            {runs.slice(0, 12).map((r) => (
              <Link
                key={r.id}
                href={`/panel/laboratorio/experimentos?id=${r.id}`}
                className={`rounded-full px-3 py-1.5 text-sm ${r.id === selected.id ? "bg-brand-600 font-semibold text-white" : "text-brand-800 ring-1 ring-brand-200 hover:bg-brand-50"}`}
              >
                {r.label.replace(/^Experimento · /, "")}
              </Link>
            ))}
          </div>
          <Card className="mb-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-xl font-semibold text-brand-950">{selected.label.replace(/^Experimento · /, "")}</h2>
                <p className="text-sm text-brand-900/65">
                  Empezó el {formatDateTime(selected.created_at, clinic.timezone)}
                  {selected.proposal_id && <> · <Link href={`/panel/laboratorio/mejoras?id=${selected.proposal_id}`} className="font-medium text-brand-700 hover:underline">ver la mejora</Link></>}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {summary?.base && <Badge tone={RUN_STATUS[summary.base.status]?.tone}>Actual: {RUN_STATUS[summary.base.status]?.label}</Badge>}
                <Badge tone={RUN_STATUS[selected.status]?.tone}>Variante: {RUN_STATUS[selected.status]?.label}</Badge>
              </div>
            </div>
            {summary?.ready ? (
              <dl className="mt-5 grid gap-4 sm:grid-cols-3">
                <div className="rounded-2xl border border-brand-900/10 p-4">
                  <dt className="text-xs font-medium uppercase tracking-wider text-brand-900/65">Versión actual</dt>
                  <dd className="mt-1 font-display text-4xl font-semibold">{fmtScore(summary.base?.score)} <span className="text-base font-normal text-brand-900/60">±{fmtScore(summary.base?.spread)}</span></dd>
                </div>
                <div className="rounded-2xl border-2 border-brand-600 p-4">
                  <dt className="text-xs font-medium uppercase tracking-wider text-brand-700">Variante</dt>
                  <dd className="mt-1 font-display text-4xl font-semibold">{fmtScore(summary.variant?.score)} <span className="text-base font-normal text-brand-900/60">±{fmtScore(summary.variant?.spread)}</span></dd>
                </div>
                <div className={`rounded-2xl p-4 ${(summary.delta ?? 0) > 0 && !summary.regressions ? "bg-emerald/10" : "bg-[#f6f7fb]"}`}>
                  <dt className="text-xs font-medium uppercase tracking-wider text-brand-900/65">Diferencia</dt>
                  <dd className="mt-1 font-display text-4xl font-semibold">{summary.delta === null ? "—" : summary.delta > 0 ? `+${summary.delta}` : summary.delta}</dd>
                  <dd className="text-xs text-brand-900/70">
                    {summary.improved} caso{summary.improved === 1 ? "" : "s"} mejoran, {summary.regressions} empeoran.
                    {summary.delta !== null && Math.abs(summary.delta) <= Math.max(num(summary.base?.spread) ?? 0, num(summary.variant?.spread) ?? 0) && " Dentro de la variación entre corridas: no es una diferencia clara."}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="mt-4 text-sm text-brand-900/70">
                Todavía corre. Versión actual: {summary?.base ? <RunLink id={summary.base.id}>{RUN_STATUS[summary.base.status]?.label}</RunLink> : "—"} · variante: <RunLink id={selected.id}>{RUN_STATUS[selected.status]?.label}</RunLink>. Se actualiza sola cada 10 minutos.
              </p>
            )}
          </Card>

          {summary?.ready && comparison && (
            <div className="grid gap-5 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
              <Card className="self-start">
                <p className="mb-3 text-xs font-medium uppercase tracking-wider text-brand-900/65">Por dimensión (actual → variante)</p>
                <DimBars dims={summary.variant?.dims ?? null} compare={summary.base?.dims ?? null} showHelp={false} />
              </Card>
              <Card className="p-0">
                <p className="px-5 pb-2 pt-5 text-xs font-medium uppercase tracking-wider text-brand-900/65">Caso por caso · tocá uno para comparar las charlas</p>
                <ul className="divide-y divide-brand-900/10">
                  {comparison.cases.map((c) => (
                    <li key={c.case_id}>
                      <Link
                        href={`/panel/laboratorio/experimentos?id=${selected.id}&caso=${encodeURIComponent(c.case_id)}`}
                        className={`grid grid-cols-[minmax(0,1fr)_48px_48px_56px] items-center gap-2 px-5 py-2.5 text-sm ${pickedCase?.case_id === c.case_id ? "bg-brand-50" : "hover:bg-brand-50/50"}`}
                      >
                        <span className="truncate font-medium">{titleOf(c.case_id)}</span>
                        <span className="text-brand-900/70">{fmtScore(c.base)}</span>
                        <span className="font-semibold">{fmtScore(c.variant)}</span>
                        <span className={`text-right font-semibold ${(c.delta ?? 0) >= 5 ? "text-emerald-700" : (c.delta ?? 0) <= -10 || (c.variantCritical && !c.baseCritical) ? "text-red-700" : "text-brand-900/60"}`}>
                          {c.delta === null ? "—" : c.delta > 0 ? `+${c.delta}` : c.delta}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                {pickedCase && (
                  <div className="grid gap-4 border-t border-brand-900/10 p-5 xl:grid-cols-2">
                    <div>
                      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-brand-900/65">Actual · {fmtScore(pickedCase.base)}</p>
                      <Transcript lines={baseRows.find((r) => r.case_id === pickedCase.case_id)?.transcript ?? []} />
                    </div>
                    <div>
                      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-brand-700">Variante · {fmtScore(pickedCase.variant)}</p>
                      <Transcript lines={variantRows.find((r) => r.case_id === pickedCase.case_id)?.transcript ?? []} />
                    </div>
                  </div>
                )}
              </Card>
            </div>
          )}
        </>
      )}
    </>
  );
}
