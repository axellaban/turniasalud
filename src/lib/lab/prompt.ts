import "server-only";
import { createHash } from "node:crypto";
import { sql } from "../db";
import { SYSTEM_PROMPT } from "../agent/prompt";

// El prompt que recibe Sofi: el del repositorio más las mejoras de prompt aprobadas en el laboratorio
// (cada una es un reemplazo exacto: old_str → new_str). Una mejora que ya no encaja porque el prompt del
// repositorio cambió no se aplica y queda marcada en el panel. Integrarlas al repositorio de vez en
// cuando y marcarlas «aplicada» deja el prompt del repositorio igual al de Sofi.

export type PromptPatch = { id: string; old_str: string; new_str: string };

/** Aplica los reemplazos en orden. Cada old_str tiene que aparecer exactamente una vez. Puro. */
export function applyPatches(base: string, patches: PromptPatch[]): { prompt: string; applied: string[]; failed: Array<{ id: string; reason: string }> } {
  let prompt = base;
  const applied: string[] = [];
  const failed: Array<{ id: string; reason: string }> = [];
  for (const p of patches) {
    const check = patchProblem(prompt, p);
    if (check) {
      failed.push({ id: p.id, reason: check });
      continue;
    }
    prompt = prompt.replace(p.old_str, () => p.new_str);
    applied.push(p.id);
  }
  return { prompt, applied, failed };
}

/** Por qué un reemplazo no se puede aplicar, o null si se puede. Puro. */
export function patchProblem(prompt: string, p: Pick<PromptPatch, "old_str" | "new_str">): string | null {
  if (!p.old_str || !p.new_str) return "El cambio está incompleto.";
  if (p.old_str === p.new_str) return "El cambio no cambia nada.";
  const first = prompt.indexOf(p.old_str);
  if (first < 0) return "El texto a reemplazar ya no está en el prompt (cambió desde que se propuso).";
  if (prompt.indexOf(p.old_str, first + 1) >= 0) return "El texto a reemplazar aparece más de una vez en el prompt.";
  return null;
}

export const promptHash = (prompt: string) => createHash("sha256").update(prompt).digest("hex").slice(0, 10);

type PatchRow = { id: string; change: { old_str?: string; new_str?: string } };

/** Las mejoras de prompt aprobadas o aplicadas, en el orden en que se decidieron. */
async function approvedPatches(): Promise<PromptPatch[]> {
  const rows = await sql<PatchRow[]>`
    select id, change from lab_proposals
    where layer = 'prompt' and status in ('aprobada', 'aplicada')
    order by coalesce(decided_at, created_at), created_at`;
  return rows
    .filter((r) => typeof r.change?.old_str === "string" && typeof r.change?.new_str === "string")
    .map((r) => ({ id: r.id, old_str: r.change.old_str as string, new_str: r.change.new_str as string }));
}

/** El prompt efectivo de Sofi (repositorio + mejoras aprobadas). */
export async function effectivePrompt(): Promise<{ prompt: string; hash: string; applied: string[]; failed: Array<{ id: string; reason: string }> }> {
  const result = applyPatches(SYSTEM_PROMPT, await approvedPatches());
  return { ...result, hash: promptHash(result.prompt) };
}

/**
 * Después de «Actualizar a Sofi»: registra la versión que quedó en ElevenLabs, marca como aplicadas las
 * mejoras que entraron y anota por qué no entraron las que fallaron.
 */
export async function recordPromptVersion(version: { hash: string; applied: string[]; failed: Array<{ id: string; reason: string }> }): Promise<void> {
  // Una fila por cambio de versión (volver a aplicar la misma no suma otra).
  await sql`
    insert into lab_versions (prompt_hash, patches)
    select ${version.hash}, ${version.applied}::uuid[]
    where coalesce((select prompt_hash from lab_versions order by applied_at desc, id desc limit 1), '') <> ${version.hash}`;
  if (version.applied.length) {
    await sql`
      update lab_proposals set status = 'aplicada', applied_at = coalesce(applied_at, now()), apply_error = null
      where id = any(${version.applied}::uuid[])`;
  }
  for (const f of version.failed) {
    await sql`update lab_proposals set apply_error = ${f.reason} where id = ${f.id}`;
  }
}

/** La versión que atendía en un momento dado (la última aplicada antes). */
export async function versionAt(at: Date | string): Promise<string | null> {
  const [row] = await sql<Array<{ prompt_hash: string }>>`
    select prompt_hash from lab_versions where applied_at <= ${new Date(at)} order by applied_at desc, id desc limit 1`;
  return row?.prompt_hash ?? null;
}

/** Cuándo empezó a atender cada versión (para mostrar «versión del 27/11»). */
export async function versionDates(): Promise<Map<string, string>> {
  const rows = await sql<Array<{ prompt_hash: string; first: string }>>`
    select prompt_hash, min(applied_at) as first from lab_versions group by prompt_hash`;
  return new Map(rows.map((r) => [r.prompt_hash, r.first]));
}
