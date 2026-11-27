import { coverageKey, isParticular, normalizeLabel } from "./booking-rules";
import { positiveAnswers, type HealthFormData } from "./health-form";

// Lo que Turnia escribe en las notas de un turno de Smile Connect. Desde el 26/11 la ficha de un
// paciente nuevo ya lleva obra social, plan y afiliado, pero la API no deja editar una ficha que ya
// existe: por eso la cobertura de cada turno sigue yendo en su nota, para que recepción la tenga a
// mano. Este archivo no toca la base.

/** Lo que acepta Smile Connect en las notas de un turno. */
export const SMILE_NOTES_MAX = 2000;

export type SmileNotePatient = { coverage: string | null; coverage_plan: string | null; member_number: string | null };
export type SmileNoteHealth = { data: HealthFormData; completed: boolean };

export type SmileNoteInput = {
  /** La prestación, o el nombre propio del turno («Consulta de implantes»). */
  prestacion: string;
  /** El origen del turno en Turnia: el panel, o Sofi (cualquier canal). */
  source: string;
  agentName: string | null;
  /** Cobertura con la que se atiende en este turno (si no, la de la ficha). */
  coverage: string | null;
  patient: SmileNotePatient | null;
  /** Motivo de consulta u observaciones que anotó Sofi. */
  motivo: string | null;
  health: SmileNoteHealth | null;
};

const clean = (value: string | null | undefined) => value?.replace(/\s+/g, " ").trim() || null;

/** ¿La cobertura del turno es la de la ficha? («OSDE» y «OSDE 210» también.) */
function sameAsPatient(coverage: string, patientCoverage: string | null): boolean {
  if (!patientCoverage) return false;
  const a = coverageKey(coverage);
  const b = coverageKey(patientCoverage);
  return a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `);
}

/**
 * La cobertura con la que va el paciente: la del turno o, si no tiene, la de la ficha. El plan y el
 * afiliado salen de la ficha, solo si es la misma cobertura. null si no la dio.
 */
export function smileCoverage(coverage: string | null, patient: SmileNotePatient | null): { name: string; plan: string | null; member: string | null; particular: boolean } | null {
  const cov = clean(coverage) ?? clean(patient?.coverage);
  if (!cov) return null;
  if (isParticular(cov)) return { name: "Particular", plan: null, member: null, particular: true };
  const same = sameAsPatient(cov, clean(patient?.coverage));
  return { name: cov, plan: same ? clean(patient?.coverage_plan) : null, member: same ? clean(patient?.member_number) : null, particular: false };
}

/** «Obra social: OSDE · Plan: 310 · Afiliado: 61234567801», «Obra social: Particular» o «Obra social: no la dio». */
export function coverageNoteLine(coverage: string | null, patient: SmileNotePatient | null): string {
  const c = smileCoverage(coverage, patient);
  if (!c) return "Obra social: no la dio";
  if (c.particular) return "Obra social: Particular";
  // «OSDE 210» ya trae el plan: no se pide aparte.
  const planInName = /\d/.test(c.name);
  return [
    `Obra social: ${c.name}`,
    c.plan ? `Plan: ${c.plan}` : planInName ? null : "Plan: no lo dio",
    `Afiliado: ${c.member ?? "no lo dio"}`,
  ].filter(Boolean).join(" · ");
}

/**
 * Lo importante de la ficha de salud para quien atiende: lo que marcó con SI y lo que contó aparte.
 * null si todavía no respondió nada.
 */
export function healthNoteLine(health: SmileNoteHealth | null): string | null {
  if (!health) return null;
  const others = clean(health.data.otros);
  const answered = Object.keys(health.data.respuestas ?? {}).length > 0 || Boolean(others);
  if (!answered) return null;
  const items = positiveAnswers(health.data);
  if (others && !/^(no|nada|ninguno|ninguna|-)\.?$/i.test(others)) items.push(`Otros: ${others}`);
  const label = health.completed ? "Ficha de salud" : "Ficha de salud (incompleta)";
  return `${label}: ${items.length ? items.join("; ") : "no marcó ninguna enfermedad ni medicación"}`;
}

const isHealthLine = (line: string) => /^Ficha de salud\b/.test(line.trim());

/** La nota completa del turno, en líneas y sin pasar lo que acepta Smile Connect. */
export function smileAppointmentNote(input: SmileNoteInput): string {
  const origin = input.source === "panel" ? "Lo cargó el consultorio en Turnia" : `Lo dio ${clean(input.agentName) ?? "Sofi"} (Turnia)`;
  const head = `${clean(input.prestacion) ?? "Turno"} · ${origin}`;
  const coverage = coverageNoteLine(input.coverage, input.patient);
  const health = healthNoteLine(input.health);
  const fixed = [head, coverage, health].filter(Boolean).join("\n").length;
  // Si no entra todo, se acorta el motivo: la obra social y la ficha de salud van enteras.
  const room = SMILE_NOTES_MAX - fixed - "\nMotivo: ".length;
  let motivo = input.motivo?.trim() || null;
  if (motivo && motivo.length > room) motivo = room > 20 ? `${motivo.slice(0, room - 1)}…` : null;
  const note = [head, coverage, motivo && `Motivo: ${motivo}`, health].filter(Boolean).join("\n");
  return note.slice(0, SMILE_NOTES_MAX);
}

/**
 * Suma la línea de la ficha de salud a la nota que tiene hoy el turno en Smile Connect, sin borrar
 * nada que haya escrito recepción. Reemplaza la línea anterior solo si es la que escribió Turnia
 * (`lastSent`); si recepción la cambió, agrega la nueva abajo. null: no hay nada que cambiar, o no entra.
 */
export function withHealthLine(current: string | null, line: string, lastSent: string | null): string | null {
  const text = (current ?? "").replace(/\s+$/, "");
  const lines = text ? text.split("\n") : [];
  if (lines.some((l) => l.trim() === line)) return null;
  const previous = lastSent ? lines.findIndex((l) => isHealthLine(l) && l.trim() === lastSent.trim()) : -1;
  if (previous >= 0) lines[previous] = line;
  else lines.push(line);
  const next = lines.join("\n");
  return next.length <= SMILE_NOTES_MAX ? next : null;
}

/** La línea de la ficha de salud dentro de una nota que mandó Turnia. */
export const healthLineOf = (note: string | null | undefined): string | null =>
  note?.split("\n").find(isHealthLine)?.trim() ?? null;

/** Agrega solo líneas faltantes. Un motivo que recepción cambió se revisa, nunca se reemplaza. */
export function withBookingNote(current: string | null, desired: string): string {
  const lines = current ? current.split('\n') : [];
  const wanted = desired.split('\n').map(l => l.trim()).filter(Boolean);
  const reason = wanted.find(l => l.startsWith('Motivo:'));
  if (reason && lines.some(l => l.trim().startsWith('Motivo:') && l.trim() !== reason)) {
    throw new Error('Recepción cambió el motivo en Smile Connect. Conserve su nota y revise el motivo en Turnia.');
  }
  for (const line of wanted) {
    // El texto guardado al reservar puede ser anterior a una actualización de la ficha/cobertura.
    if (isHealthLine(line) && lines.some(isHealthLine)) continue;
    if (line.startsWith('Obra social:') && lines.some(l => l.trim().startsWith('Obra social:'))) continue;
    if (!lines.some(l => l.trim() === line)) lines.push(line);
  }
  const next = lines.join('\n');
  if (next.length > SMILE_NOTES_MAX) throw new Error('La nota de Smile Connect no tiene espacio. El motivo sigue disponible en Turnia.');
  return next;
}

export type SmileServiceName = { service_id: number; name: string };

/**
 * La prestación de Smile Connect que se llama igual que la de Turnia (sin importar mayúsculas ni
 * acentos). Prueba primero el nombre propio del turno y después la prestación. Sin una coincidencia
 * única, null: la prestación igual queda escrita en la nota.
 */
export function matchSmileService(services: SmileServiceName[] | null | undefined, names: Array<string | null | undefined>): number | null {
  if (!services?.length) return null;
  for (const name of names) {
    if (!name?.trim()) continue;
    const key = normalizeLabel(name);
    const hits = services.filter((s) => normalizeLabel(s.name) === key);
    if (hits.length === 1) return hits[0].service_id;
  }
  return null;
}
