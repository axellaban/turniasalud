import Link from "next/link";
import type { Metadata } from "next";
import { Badge, Card, Empty, Notice, dangerButtonClass, inputClass, secondaryButtonClass } from "@/components/ui";
import { getPanelClinic, requireAdmin } from "@/lib/panel-clinic";
import { formatDateTime } from "@/lib/time";
import { findEvidence, labProposals } from "@/lib/lab/panel";
import { experimentSummary, type LabProposal } from "@/lib/lab/proposals";
import { DIMENSION_LABEL } from "@/lib/lab/score";
import { labApprove, labExperiment, labReject, labRevert } from "../../../lab-actions";
import { LabForm } from "../lab-form";
import { LabHeader, fmtScore } from "../lab-ui";

export const metadata: Metadata = { title: "Mejoras · Laboratorio de Sofi" };
export const maxDuration = 300;

const LEVEL = {
  A: { label: "A · forma", className: "bg-emerald/15 text-emerald-700" },
  B: { label: "B · lógica", className: "bg-brand-50 text-brand-700" },
  C: { label: "C · regla o clínica", className: "bg-[#efeeff] text-[#4a3fb8]" },
} as const;

const LAYER: Record<string, string> = {
  prompt: "Prompt de Sofi",
  consultorio: "Instrucciones del consultorio",
  herramienta: "Código de una herramienta",
  configuracion: "Configuración del panel",
};

const STATUS: Record<string, { label: string; tone: "gray" | "green" | "yellow" | "red" | "blue" }> = {
  pendiente: { label: "Espera su sí", tone: "blue" },
  probando: { label: "Probando", tone: "yellow" },
  aprobada: { label: "Aprobada", tone: "green" },
  aplicada: { label: "En Sofi", tone: "green" },
  rechazada: { label: "Rechazada", tone: "gray" },
  no_aplica: { label: "No aplica", tone: "gray" },
};

function LevelBadge({ level }: { level: LabProposal["level"] }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${LEVEL[level].className}`}>{LEVEL[level].label}</span>;
}

export default async function ProposalsPage({ searchParams }: PageProps<"/panel/laboratorio/mejoras">) {
  await requireAdmin();
  const clinic = await getPanelClinic();
  const { id } = (await searchParams) as { id?: string };
  const proposals = await labProposals(clinic.id);
  const current = proposals.find((p) => p.id === id) ?? proposals.find((p) => ["pendiente", "probando"].includes(p.status)) ?? proposals[0] ?? null;
  const experiment = current?.experiment_run_id ? await experimentSummary(current.experiment_run_id) : null;
  const evidenceLinks = current ? await Promise.all(current.evidence.map((e) => findEvidence(clinic.id, e.cita).catch(() => null))) : [];
  const pending = proposals.filter((p) => p.status === "pendiente").length;

  return (
    <>
      <LabHeader
        current="/panel/laboratorio/mejoras"
        title="Mejoras"
        description="Lo que propone Claude a partir de las fallas, ya probado en el laboratorio cuando es un cambio de prompt. Ustedes deciden; lo que rechazan queda en Criterios y no se vuelve a proponer."
        counts={{ "/panel/laboratorio/mejoras": pending }}
        actions={
          <div className="flex flex-wrap gap-1.5">
            <LevelBadge level="A" />
            <LevelBadge level="B" />
            <LevelBadge level="C" />
          </div>
        }
      />
      {!proposals.length ? (
        <Empty>Todavía no hay propuestas. Claude propone una vez por día, después de la batería; también se pueden pedir desde Resumen o desde una charla.</Empty>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
          <ul className="space-y-2 self-start">
            {proposals.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/panel/laboratorio/mejoras?id=${p.id}`}
                  className={`block rounded-2xl border bg-white p-3.5 text-sm ${p.id === current?.id ? "border-brand-500 ring-1 ring-brand-500" : "border-brand-900/10 hover:border-brand-200"}`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <LevelBadge level={p.level} />
                    <Badge tone={STATUS[p.status]?.tone}>{STATUS[p.status]?.label}</Badge>
                  </span>
                  <span className="mt-2 block font-semibold text-brand-950">{p.title}</span>
                  <span className="mt-1 block text-xs text-brand-900/60">{LAYER[p.layer]} · {formatDateTime(p.created_at, clinic.timezone)}</span>
                </Link>
              </li>
            ))}
          </ul>

          {current && (
            <Card className="space-y-5">
              <div>
                <div className="flex flex-wrap gap-1.5">
                  <LevelBadge level={current.level} />
                  <Badge>{LAYER[current.layer]}</Badge>
                  {current.dimension && <Badge>{DIMENSION_LABEL[current.dimension]}</Badge>}
                  <Badge tone={STATUS[current.status]?.tone}>{STATUS[current.status]?.label}</Badge>
                </div>
                <h2 className="mt-3 font-display text-2xl font-semibold tracking-tight text-brand-950">{current.title}</h2>
              </div>

              {current.apply_error && <Notice tone="warning">{current.apply_error}</Notice>}

              <section>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-brand-900/65">Por qué</p>
                <p className="text-sm text-brand-950">{current.why}</p>
                {current.evidence.length > 0 && (
                  <ul className="mt-2 space-y-1.5">
                    {current.evidence.map((e, i) => (
                      <li key={i} className="rounded-xl bg-[#f3efe8] px-3 py-2 text-sm">
                        «{e.cita}» <span className="text-xs text-brand-900/60">· {e.fuente}</span>
                        {evidenceLinks[i] && (
                          <Link
                            href={evidenceLinks[i]?.kind === "laboratorio"
                              ? `/panel/laboratorio/corridas/${(evidenceLinks[i] as { run_id: string }).run_id}?caso=${encodeURIComponent((evidenceLinks[i] as { case_id: string }).case_id)}`
                              : `/panel/conversaciones/${(evidenceLinks[i] as { conversation_id: string }).conversation_id}`}
                            className="ml-1 whitespace-nowrap text-xs font-semibold text-brand-700 hover:underline"
                          >
                            Ver la charla →
                          </Link>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-brand-900/65">Qué cambia</p>
                {current.layer === "prompt" ? (
                  <div className="overflow-x-auto rounded-xl border border-brand-900/10 font-mono text-xs leading-relaxed">
                    <p className="whitespace-pre-wrap bg-red-50 px-3 py-2 text-red-900">− {current.change.old_str}</p>
                    <p className="whitespace-pre-wrap bg-emerald/10 px-3 py-2 text-emerald-700">+ {current.change.new_str}</p>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap rounded-xl bg-[#f6f7fb] px-3 py-2 text-sm">{current.change.text}</p>
                )}
                {current.layer === "consultorio" && <p className="mt-1.5 text-xs text-brand-900/65">Se suma al final de las instrucciones de {clinic.name} (Configuración). Tiene efecto en la próxima charla.</p>}
                {(current.layer === "herramienta" || current.layer === "configuracion") && (
                  <p className="mt-1.5 text-xs text-brand-900/65">Toca código o datos del panel: al aprobarla queda en la lista para implementarla (por ejemplo, pedírselo a Claude Code con este texto).</p>
                )}
              </section>

              {current.layer === "prompt" && (
                <section className="rounded-2xl bg-[#f6f7fb] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-medium uppercase tracking-wider text-brand-900/65">Resultado en el laboratorio</p>
                    {current.experiment_run_id && <Link href={`/panel/laboratorio/experimentos?id=${current.experiment_run_id}`} className="text-sm font-medium text-brand-700 hover:underline">Ver experimento</Link>}
                  </div>
                  {experiment?.ready ? (
                    <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
                      <div><dt className="text-xs text-brand-900/65">Puntaje</dt><dd className="text-xl font-semibold">{fmtScore(experiment.base?.score)} → <span className="text-emerald-700">{fmtScore(experiment.variant?.score)}</span></dd></div>
                      <div><dt className="text-xs text-brand-900/65">Casos que mejoran</dt><dd className="text-xl font-semibold">{experiment.improved}</dd></div>
                      <div><dt className="text-xs text-brand-900/65">Casos que empeoran</dt><dd className={`text-xl font-semibold ${experiment.regressions ? "text-red-700" : ""}`}>{experiment.regressions}</dd></div>
                    </dl>
                  ) : current.experiment_run_id ? (
                    <p className="mt-2 text-sm text-brand-900/70">El experimento está corriendo: la versión actual contra la variante, con los mismos casos.</p>
                  ) : (
                    <p className="mt-2 text-sm text-brand-900/70">Todavía no se probó.</p>
                  )}
                  {current.status === "pendiente" && !current.apply_error?.startsWith("El texto") && (
                    <LabForm action={labExperiment} submit={current.experiment_run_id ? "Probar de nuevo" : "Probar en el laboratorio"} pending="Armando el experimento…" button={`${secondaryButtonClass} mt-3`}>
                      <input type="hidden" name="mejora" value={current.id} />
                    </LabForm>
                  )}
                </section>
              )}

              {["pendiente", "probando"].includes(current.status) && (
                <section className="space-y-4 border-t border-brand-900/10 pt-5">
                  <LabForm
                    action={labApprove}
                    submit={current.layer === "prompt" ? "Aprobar y publicar en Sofi" : current.layer === "consultorio" ? "Aprobar y sumar a las instrucciones" : "Aprobar"}
                    pending="Aplicando…"
                    confirm={current.layer === "prompt" ? "Se actualiza a Sofi con este cambio (todas las clínicas que usan el agente general). ¿Seguimos?" : undefined}
                    className="space-y-2"
                  >
                    <input type="hidden" name="mejora" value={current.id} />
                    {current.layer === "consultorio" && (
                      <label className="flex items-start gap-2 text-sm">
                        <input type="checkbox" name="confirmo" className="mt-1" />
                        <span>Confirmo que el consultorio aprobó esta regla.</span>
                      </label>
                    )}
                    {current.layer === "prompt" && !experiment?.ready && <p className="text-xs text-sun-700">Todavía no hay resultado del experimento: se puede aprobar igual, pero conviene esperar.</p>}
                  </LabForm>
                  <LabForm action={labReject} submit="Rechazar y guardar el criterio" pending="Guardando…" button={dangerButtonClass} className="space-y-2">
                    <input type="hidden" name="mejora" value={current.id} />
                    <label className="block text-sm">
                      <span className="font-medium">¿Por qué no?</span> <span className="text-brand-900/60">Queda en Criterios: el juez y Claude lo leen.</span>
                      <textarea name="motivo" rows={2} className={`${inputClass} mt-1`} required />
                    </label>
                  </LabForm>
                </section>
              )}

              {(current.status === "aplicada" || (current.status === "aprobada" && current.layer === "prompt")) && (current.layer === "prompt" || current.layer === "consultorio") && (
                <section className="border-t border-brand-900/10 pt-5">
                  <p className="mb-2 text-sm text-brand-900/75">
                    En Sofi desde el {current.applied_at ? formatDateTime(current.applied_at, clinic.timezone) : "—"}{current.decided_by ? ` · aprobó ${current.decided_by}` : ""}.
                  </p>
                  <LabForm action={labRevert} submit="Quitar de Sofi" pending="Quitando…" button={dangerButtonClass} confirm="Sofi vuelve a la versión sin este cambio. ¿Seguimos?">
                    <input type="hidden" name="mejora" value={current.id} />
                  </LabForm>
                </section>
              )}
              {current.status === "rechazada" && current.decision_reason && (
                <p className="border-t border-brand-900/10 pt-5 text-sm text-brand-900/75">Rechazada: {current.decision_reason}</p>
              )}
            </Card>
          )}
        </div>
      )}
    </>
  );
}
