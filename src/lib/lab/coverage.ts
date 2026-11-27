import "server-only";
import { sql } from "../db";
import type { Clinic } from "../types";
import { VALID_CELLS } from "./cases";
import { draftLabCase, saveCase } from "./proposals";
import { allCases } from "./runs";

// Cobertura completa: cada tipo de caso con sentido (VALID_CELLS) tiene al menos un caso en la batería. Los
// que faltan los arma Claude, de a pocos por vuelta del cron, tomando como ejemplo las charlas reales de
// ese tipo si las hay. Quedan guardados como «exploratorio» (Cobertura → Casos guardados) y entran en la
// batería siguiente.

export async function missingCells(clinicId: string): Promise<Array<{ intent: string; situation: string; real: number }>> {
  const cases = await allCases(clinicId);
  const real = await sql<Array<{ intent: string; situation: string; n: number }>>`
    select intent, situation, count(*)::int as n from lab_reviews
    where clinic_id = ${clinicId} and not is_test and intent is not null and situation is not null and reviewed_at > now() - interval '30 days'
    group by 1, 2`;
  // También cuentan los casos desactivados: si el equipo sacó uno, no se vuelve a generar.
  const inactive = await sql<Array<{ intent: string; situation: string }>>`
    select intent, situation from lab_cases where not active and (clinic_id is null or clinic_id = ${clinicId})`;
  const has = (i: string, s: string) => cases.some((c) => c.intent === i && c.situation === s) || inactive.some((c) => c.intent === i && c.situation === s);
  return VALID_CELLS.filter(([i, s]) => !has(i, s))
    .map(([intent, situation]) => ({ intent, situation, real: real.find((r) => r.intent === intent && r.situation === situation)?.n ?? 0 }))
    .sort((a, b) => b.real - a.real);
}

/** Arma casos para hasta `limit` tipos de caso que faltan. Devuelve los títulos. */
export async function fillCoverage(clinic: Clinic, limit: number, budgetMs: number): Promise<string[]> {
  const started = Date.now();
  const titles: string[] = [];
  for (const cell of (await missingCells(clinic.id)).slice(0, limit)) {
    if (Date.now() - started > budgetMs) break;
    const examples = await sql<Array<{ summary: string | null }>>`
      select summary from lab_reviews where clinic_id = ${clinic.id} and intent = ${cell.intent} and situation = ${cell.situation} and summary is not null
      order by reviewed_at desc limit 4`;
    const labCase = await draftLabCase(
      clinic,
      `Un caso de motivo «${cell.intent}» en la situación «${cell.situation}».${
        examples.length ? ` Como estas charlas reales:\n${examples.map((e) => `- ${e.summary}`).join("\n")}` : " No hay charlas reales de este tipo todavía: armá la situación más común en un consultorio odontológico."
      }`,
    );
    labCase.intent = cell.intent as typeof labCase.intent;
    labCase.situation = cell.situation as typeof labCase.situation;
    await saveCase(clinic.id, labCase, "exploratorio", "Laboratorio (cobertura)");
    titles.push(labCase.titulo);
  }
  return titles;
}
