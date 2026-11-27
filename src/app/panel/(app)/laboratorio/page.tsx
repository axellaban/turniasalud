import Link from "next/link";
import type { Metadata } from "next";
import { Card, Notice, ghostButtonClass, secondaryButtonClass } from "@/components/ui";
import { getPanelClinic, requireAdmin } from "@/lib/panel-clinic";
import { formatDateTime } from "@/lib/time";
import { labJudgeConfigured } from "@/lib/lab/judge";
import { labOverview, num } from "@/lib/lab/panel";
import { versionDates } from "@/lib/lab/prompt";
import { DIMENSION_LABEL } from "@/lib/lab/score";
import type { LabSettings } from "@/lib/lab/tick";
import { labGenerateProposals, labRunBattery, labSettings } from "../../lab-actions";
import { LabForm } from "./lab-form";
import { BandBadge, DimBars, LabHeader, RUN_STATUS, RunLink, ScoreRing, fmtScore, modelLabel, scoreTone } from "./lab-ui";

export const metadata: Metadata = { title: "Laboratorio de Sofi · Panel" };
export const maxDuration = 300;

export default async function LabPage() {
  await requireAdmin();
  const clinic = await getPanelClinic();
  const [o, dates] = await Promise.all([labOverview(clinic.id), versionDates()]);
  const settings: LabSettings = clinic.lab_settings ?? {};
  const enabled = Boolean(clinic.lab_enabled);
  const score = num(o.latest?.score);
  const delta = score !== null && o.previous ? Math.round(score - Number(o.previous.score)) : null;
  const gap = score !== null && o.real.score !== null ? Math.round(score - o.real.score) : null;
  const shortDate = (d: string | Date) => new Intl.DateTimeFormat("es-AR", { timeZone: clinic.timezone, day: "numeric", month: "numeric" }).format(new Date(d));
  // La versión se nombra por el día en que llegó a Sofi («Actualizar a Sofi»); si nunca llegó, por su código.
  const versionLabel = (hash: string) => {
    const d = dates.get(hash);
    return d ? `del ${shortDate(d)}` : `sin publicar (${hash.slice(0, 6)})`;
  };

  return (
    <>
      <LabHeader
        current="/panel/laboratorio"
        title="Laboratorio de Sofi"
        description={`Probá, medí y mejorá a ${clinic.agent_name} antes de que lo note un paciente. Cada corrida simula pacientes, los puntúa de 1 a 100 y propone mejoras.`}
        counts={{ "/panel/laboratorio/mejoras": o.pending }}
        actions={
          <>
            <LabForm action={labRunBattery} submit="Correr la batería ahora" pending="Armando las simulaciones…" button={secondaryButtonClass}>
              <input type="hidden" name="repetir" value="3" />
            </LabForm>
            <Link href="/panel/laboratorio/jugar" className="inline-flex items-center justify-center gap-1 rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
              Jugar de paciente
            </Link>
          </>
        }
      />

      {!labJudgeConfigured() && (
        <Notice tone="warning" className="mb-5">
          Falta <code>ANTHROPIC_API_KEY</code> en Vercel: las simulaciones corren, pero no se pueden puntuar ni proponer mejoras.
        </Notice>
      )}
      {o.running && (
        <Notice className="mb-5">
          Hay una corrida en marcha: <RunLink id={o.running.id}>{o.running.label}</RunLink> · {RUN_STATUS[o.running.status]?.label}. Se actualiza sola cada 10 minutos.
        </Notice>
      )}

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wider text-brand-900/65">Puntaje de {clinic.agent_name} · {clinic.name}</p>
            <BandBadge score={score} />
          </div>
          {o.latest ? (
            <div className="mt-4 flex flex-wrap items-center gap-6">
              <ScoreRing score={score} />
              <div className="min-w-0 flex-1 space-y-1.5 text-sm">
                {delta !== null && (
                  <p className="text-base">
                    <strong className={delta >= 0 ? "text-emerald-700" : "text-red-700"}>{delta > 0 ? `+${delta}` : delta}</strong> respecto de la batería anterior.
                  </p>
                )}
                <p className="text-brand-900/70">
                  Batería del {formatDateTime(o.latest.finished_at as string, clinic.timezone)} · versión {versionLabel(o.latest.prompt_hash)} ·{" "}
                  <RunLink id={o.latest.id}>ver la corrida</RunLink>
                </p>
                <p className="text-brand-900/70">Sofi respondió con {modelLabel(o.latest.agent_llm)}. Las charlas reales y las de prueba en producción usan el modelo de producción.</p>
                {num(o.latest.spread) !== null && <p className="text-brand-900/70">Varía ±{fmtScore(o.latest.spread)} entre repeticiones: una diferencia menor no cuenta como mejora.</p>}
                {o.latest.critical_count > 0 && (
                  <p className="text-red-700">{o.latest.critical_count} falla{o.latest.critical_count === 1 ? "" : "s"} crítica{o.latest.critical_count === 1 ? "" : "s"}: el puntaje queda en 69 como máximo.</p>
                )}
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-brand-900/70">
              Todavía no hay una batería terminada. {enabled ? "La de esta noche corre entre las 2 y las 6" : "Prendé el laboratorio abajo o corré la batería ahora"}: tarda entre 30 y 60 minutos.
            </p>
          )}
          <dl className="mt-5 grid grid-cols-1 gap-3 border-t border-brand-900/10 pt-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wider text-brand-900/65">Laboratorio</dt>
              <dd className="mt-1 font-display text-2xl font-semibold">{fmtScore(score)}</dd>
              <dd className="text-xs text-brand-900/65">{o.latest ? `${o.latest.cases.length} casos × ${o.latest.repeat_count}` : "sin corridas"}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wider text-brand-900/65">Prueba en producción</dt>
              <dd className="mt-1 font-display text-2xl font-semibold">{fmtScore(o.tests.score)}</dd>
              <dd className="text-xs text-brand-900/65">{o.tests.count} charla{o.tests.count === 1 ? "" : "s"} de testers · 7 días</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wider text-brand-900/65">Charlas reales</dt>
              <dd className="mt-1 font-display text-2xl font-semibold">{fmtScore(o.real.score)}</dd>
              <dd className="text-xs text-brand-900/65">{o.real.count} charla{o.real.count === 1 ? "" : "s"} · 7 días</dd>
            </div>
          </dl>
          {gap !== null && gap >= 5 && (
            <Notice tone="warning" className="mt-4">
              Las charlas reales puntúan {gap} menos que el laboratorio: hay situaciones reales que todavía no se prueban.{" "}
              <Link href="/panel/laboratorio/cobertura" className="font-semibold underline">Ver cobertura</Link>
            </Notice>
          )}
        </Card>

        <Card>
          <p className="text-xs font-medium uppercase tracking-wider text-brand-900/65">Cómo se calcula</p>
          <p className="mb-4 mt-1.5 text-sm text-brand-900/70">
            Cada charla se puntúa de 0 a 100 con estos pesos (lo que no aplica no cuenta). El puntaje es el promedio, pesado por lo frecuente que es cada motivo en las charlas reales.
          </p>
          <DimBars dims={o.latest?.dims ?? null} />
          <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-900">
            <strong>Falla crítica:</strong> una urgencia mal derivada, una indicación médica o un turno inventado deja esa charla en 0, y el puntaje no pasa de 69 hasta que se corrige.
          </p>
        </Card>
      </div>

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wider text-brand-900/65">Evolución por batería</p>
            <span className="text-xs text-brand-900/60">Las últimas {o.history.length || 0}</span>
          </div>
          {o.history.length ? (
            <div className="mt-4 flex h-48 items-end gap-3 overflow-x-auto border-b border-brand-900/10 pb-1">
              {o.history.map((r) => {
                const s = num(r.score) ?? 0;
                return (
                  <Link key={r.id} href={`/panel/laboratorio/corridas/${r.id}`} className="flex h-full min-w-12 flex-1 flex-col items-center justify-end gap-1.5" title={`Versión ${versionLabel(r.prompt_hash)}`}>
                    <span className="text-xs font-semibold">{fmtScore(s)}</span>
                    <span className="w-full max-w-16 rounded-t-lg" style={{ height: `${Math.max(4, (s - 30) * 2.2)}px`, background: scoreTone(s) }} />
                    <span className="text-[11px] text-brand-900/65">{shortDate(r.finished_at as string)}</span>
                  </Link>
                );
              })}
            </div>
          ) : (
            <p className="mt-4 text-sm text-brand-900/70">Aparece cuando termine la primera batería.</p>
          )}
        </Card>

        <Card>
          <p className="text-xs font-medium uppercase tracking-wider text-brand-900/65">Pendiente de ustedes</p>
          <ul className="mt-2 divide-y divide-brand-900/10 text-sm">
            <li className="flex items-center justify-between gap-3 py-3">
              <span><strong>{o.pending} mejora{o.pending === 1 ? "" : "s"}</strong> esperan su sí{o.experimentsReady ? ` · ${o.experimentsReady} ya probada${o.experimentsReady === 1 ? "" : "s"} en el laboratorio` : ""}</span>
              <Link href="/panel/laboratorio/mejoras" className={ghostButtonClass}>Revisar</Link>
            </li>
            <li className="py-3">
              <LabForm action={labGenerateProposals} submit="Pedir propuestas ahora" pending="Claude está leyendo las fallas…" button={ghostButtonClass} className="flex flex-wrap items-center justify-between gap-2">
                <span>Claude propone mejoras solo, una vez por día, después de la batería.</span>
              </LabForm>
            </li>
          </ul>
          <LabForm action={labSettings} submit="Guardar" button={secondaryButtonClass} className="mt-2 space-y-2 border-t border-brand-900/10 pt-4 text-sm">
            <label className="flex items-start gap-2">
              <input type="checkbox" name="lab_enabled" defaultChecked={enabled} className="mt-1" />
              <span><strong>Laboratorio prendido</strong>: batería cada noche (2 a 6 h), revisión de las charlas reales y propuestas diarias.</span>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" name="resumen_whatsapp" defaultChecked={Boolean(settings.resumen_whatsapp)} className="mt-1" />
              <span><strong>Resumen por WhatsApp</strong> a Axel, a partir de las 9, solo si hay algo nuevo.</span>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" name="auto_a" defaultChecked={Boolean(settings.auto_a)} className="mt-1" />
              <span><strong>Publicar solas las de nivel A</strong> (solo forma) si el experimento no empeora nada. Conviene prenderlo después de unas semanas.</span>
            </label>
          </LabForm>
        </Card>
      </div>

      <Card className="p-0">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pb-2 pt-5">
          <p className="text-xs font-medium uppercase tracking-wider text-brand-900/65">Qué más le baja el puntaje</p>
          <span className="text-xs text-brand-900/60">Última batería y charlas reales de 7 días</span>
        </div>
        {o.failing.length || o.realProblems.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-brand-900/65">
                <tr>
                  <th className="px-5 py-2 font-medium">Problema</th>
                  <th className="px-3 py-2 font-medium">Dimensión</th>
                  <th className="px-3 py-2 font-medium">Veces</th>
                  <th className="px-5 py-2 font-medium">Dónde</th>
                </tr>
              </thead>
              <tbody>
                {o.failing.map((f) => (
                  <tr key={f.text} className="border-t border-brand-900/10 align-top">
                    <td className="px-5 py-3">{f.text}</td>
                    <td className="px-3 py-3 whitespace-nowrap">{DIMENSION_LABEL[f.dim]}</td>
                    <td className="px-3 py-3">{f.count}</td>
                    <td className="px-5 py-3 text-brand-900/70">Laboratorio: {f.cases.slice(0, 2).join(", ")}{f.cases.length > 2 ? "…" : ""}</td>
                  </tr>
                ))}
                {o.realProblems.map((f) => (
                  <tr key={f.text} className="border-t border-brand-900/10 align-top">
                    <td className="px-5 py-3">{f.text}{f.example && <span className="mt-0.5 block text-xs text-brand-900/65">«{f.example}»</span>}</td>
                    <td className="px-3 py-3 whitespace-nowrap">{DIMENSION_LABEL[f.dim as keyof typeof DIMENSION_LABEL] ?? f.dim}</td>
                    <td className="px-3 py-3">{f.count}</td>
                    <td className="px-5 py-3 text-brand-900/70"><Link href="/panel/laboratorio/charlas?filtro=bajas" className="text-brand-700 hover:underline">Charlas reales</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-5 pb-5 text-sm text-brand-900/70">Sin fallas registradas todavía.</p>
        )}
      </Card>
    </>
  );
}
