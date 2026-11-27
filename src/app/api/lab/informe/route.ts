import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { isUuid } from "@/lib/clinic";
import { getRun, runResults } from "@/lib/lab/runs";
import { experimentSummary } from "@/lib/lab/proposals";

// Informe de solo lectura del Laboratorio de Sofi para revisarlo fuera del panel (por ejemplo, Claude Code).
// Protegido con su propia clave (LAB_REPORT_TOKEN, header x-lab-token): no da acceso a nada más.
//   GET /api/lab/informe                 → últimas corridas, propuestas, criterios y charlas puntuadas
//   GET /api/lab/informe?corrida=<id>    → una corrida completa, charla por charla
// Las charlas simuladas son ficticias; de las reales solo van el puntaje, el resumen y los hallazgos.

export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const expected = process.env.LAB_REPORT_TOKEN;
  const received = request.headers.get("x-lab-token") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || expected.length < 24 || !received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!process.env.LAB_REPORT_TOKEN) return NextResponse.json({ ok: false, error: "Falta LAB_REPORT_TOKEN en Vercel." }, { status: 503 });
  if (!authorized(request)) return NextResponse.json({ ok: false, error: "No autorizado." }, { status: 401 });
  const url = new URL(request.url);
  const id = url.searchParams.get("corrida");
  if (id) {
    if (!isUuid(id)) return NextResponse.json({ ok: false, error: "Corrida inválida." }, { status: 400 });
    const run = await getRun(id);
    if (!run) return NextResponse.json({ ok: false, error: "No existe." }, { status: 404 });
    const results = await runResults(id);
    const experiment = run.kind === "experimento" ? await experimentSummary(id) : null;
    return NextResponse.json({
      ok: true,
      corrida: { ...run, prompt_override: run.prompt_override ? `${run.prompt_override.length} caracteres` : null },
      experimento: experiment && { listo: experiment.ready, diferencia: experiment.delta, regresiones: experiment.regressions, mejoran: experiment.improved, casos: experiment.comparison?.cases ?? [] },
      resultados: results.map((r) => ({ ...r, transcript: r.transcript })),
    });
  }
  const [runs, proposals, criteria, reviews] = await Promise.all([
    sql`select id, clinic_id, kind, status, label, prompt_hash, repeat_count, score, spread, dims, critical_count, error,
          jsonb_array_length(cases) as casos, created_at, started_at, finished_at
        from lab_runs order by created_at desc limit 30`,
    sql`select id, clinic_id, level, layer, dimension, title, why, evidence, change, status, experiment_run_id, decision_reason, apply_error, created_at
        from lab_proposals order by created_at desc limit 40`,
    sql`select clinic_id, text, created_by, created_at from lab_criteria order by created_at desc limit 60`,
    sql`select r.conversation_id, r.clinic_id, r.is_test, r.intent, r.situation, r.score, r.dims, r.critical, r.summary, r.findings, r.error, r.reviewed_at, c.started_at
        from lab_reviews r join conversations c on c.id = r.conversation_id order by r.reviewed_at desc limit 60`,
  ]);
  const clinics = await sql`select id, name, lab_enabled, lab_settings from clinics where lab_enabled`;
  return NextResponse.json({ ok: true, clinicas: clinics, corridas: runs, propuestas: proposals, criterios: criteria, charlas: reviews });
}
