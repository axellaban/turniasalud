// El horario de atención armado con los horarios reales de los profesionales (Equipo y horarios),
// y si el texto que escribió el consultorio («Horario de atención») dice otra cosa. Es puro (sin
// base) para poder probarlo: lo usan la Configuración, para avisar, y el contexto de Sofi.

import type { Schedule } from "./types";

type Range = Pick<Schedule, "weekday" | "start_time" | "end_time"> & Partial<Pick<Schedule, "urgent_only" | "appointment_type_ids">>;

/** De lunes a domingo, como se dice. */
const DAYS: Array<[number, string]> = [[1, "lunes"], [2, "martes"], [3, "miércoles"], [4, "jueves"], [5, "viernes"], [6, "sábado"], [0, "domingo"]];
const ORDER = DAYS.map(([d]) => d);

const minutes = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
};
/** 540 → «9», 1050 → «17:30». */
const hourText = (m: number) => (m % 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}` : String(Math.floor(m / 60)));

/** Los tramos comunes de cada día (sin los de solo urgencias ni los de algunas prestaciones), unidos. */
function dayRanges(schedules: Range[]): Map<number, Array<[number, number]>> {
  const byDay = new Map<number, Array<[number, number]>>();
  for (const s of schedules) {
    if (s.urgent_only || (s.appointment_type_ids?.length ?? 0) > 0) continue;
    const list = byDay.get(s.weekday) ?? [];
    list.push([minutes(s.start_time), minutes(s.end_time)]);
    byDay.set(s.weekday, list);
  }
  for (const [day, list] of byDay) {
    list.sort((a, b) => a[0] - b[0]);
    const merged: Array<[number, number]> = [];
    for (const r of list) {
      const last = merged.at(-1);
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else merged.push([...r]);
    }
    byDay.set(day, merged);
  }
  return byDay;
}

const rangesText = (list: Array<[number, number]>) => list.map(([a, b]) => `de ${hourText(a)} a ${hourText(b)}`).join(" y ");

/** [1,2,3,5] → «lunes a miércoles y viernes»; [1,3,5] → «lunes, miércoles y viernes». */
function daysText(days: number[]): string {
  const name = (d: number) => DAYS.find(([x]) => x === d)![1];
  const runs: number[][] = [];
  for (const d of [...days].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))) {
    const run = runs.at(-1);
    if (run && ORDER.indexOf(d) === ORDER.indexOf(run.at(-1)!) + 1) run.push(d);
    else runs.push([d]);
  }
  const parts = runs.flatMap((r) => (r.length >= 3 ? [`${name(r[0])} a ${name(r.at(-1)!)}`] : r.map(name)));
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} y ${parts.at(-1)}`;
}

/**
 * «Lunes, miércoles y viernes de 8 a 17, martes y jueves de 8 a 19 y sábado de 9 a 13». Los días
 * con el mismo horario van juntos. null si no hay horarios cargados.
 */
export function scheduleSummary(schedules: Range[]): string | null {
  const byDay = dayRanges(schedules);
  const groups: Array<{ days: number[]; text: string }> = [];
  for (const day of ORDER) {
    const list = byDay.get(day);
    if (!list?.length) continue;
    const text = rangesText(list);
    const same = groups.find((g) => g.text === text);
    if (same) same.days.push(day);
    else groups.push({ days: [day], text });
  }
  if (!groups.length) return null;
  const parts = groups.map((g) => `${daysText(g.days)} ${g.text}`);
  const sentence = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} y ${parts.at(-1)}`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

const normalize = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const DAY_WORDS: Array<[number, RegExp]> = [[1, /lunes/], [2, /martes/], [3, /miercoles/], [4, /jueves/], [5, /viernes/], [6, /sabados?/], [0, /domingos?/]];
const DAY_RE = "(lunes|martes|miercoles|jueves|viernes|sabados?|domingos?)";

/** Los días que nombra el texto («lunes a jueves» son cuatro). null si no nombra ninguno. */
export function daysInText(text: string): Set<number> | null {
  const t = normalize(text);
  const found = new Set<number>();
  const dayOf = (w: string) => DAY_WORDS.find(([, re]) => re.test(w))![0];
  for (const m of t.matchAll(new RegExp(`${DAY_RE}\\s+(?:a|al|hasta)\\s+${DAY_RE}`, "g"))) {
    const from = ORDER.indexOf(dayOf(m[1]));
    const to = ORDER.indexOf(dayOf(m[2]));
    if (from <= to) for (let i = from; i <= to; i++) found.add(ORDER[i]);
  }
  for (const [day, re] of DAY_WORDS) if (re.test(t)) found.add(day);
  return found.size ? found : null;
}

/** Las horas que dice el texto, en minutos («de 9 a 17:30 hs» → 540 y 1050). */
export function timesInText(text: string): Set<number> {
  const out = new Set<number>();
  const t = normalize(text);
  for (const m of t.matchAll(/\b(\d{1,2})(?:[:.](\d{2}))?(?!\d)\s*(?:hs?\b|horas?\b)?/g)) {
    const before = t.slice(Math.max(0, (m.index ?? 0) - 4), m.index);
    const after = t.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 3);
    // Solo las horas de un horario («de 9», «a 18», «9 a», «17:30»), no otros números.
    if (!m[2] && !/(de|a|al|y|-|–)\s*$/.test(before) && !/^\s*(a|-|–)/.test(after) && !/hs?|hora/.test(m[0])) continue;
    const h = Number(m[1]);
    const min = Number(m[2] ?? 0);
    if (h <= 24 && min < 60) out.add(h * 60 + min);
  }
  return out;
}

/**
 * ¿El horario que escribió el consultorio contradice los horarios cargados? Cada día tiene que
 * empezar y terminar a una hora que diga el texto, y el texto no puede decir una hora que no sea
 * de ningún horario. Si nombra días, tienen que ser los días con horarios. Así, «de 9 a 18» con un
 * corte al mediodía no se marca, pero «de 10 a 17:30» cuando la agenda empieza a las 9, sí.
 */
export function hoursTextMismatch(text: string | null | undefined, schedules: Range[]): boolean {
  if (!text?.trim()) return false;
  const byDay = dayRanges(schedules);
  if (!byDay.size) return false;
  const times = timesInText(text);
  if (times.size) {
    const boundaries = new Set<number>();
    for (const list of byDay.values()) for (const [a, b] of list) boundaries.add(a).add(b);
    for (const t of times) if (!boundaries.has(t)) return true;
    for (const list of byDay.values()) if (!times.has(list[0][0]) || !times.has(list.at(-1)![1])) return true;
  }
  const days = daysInText(text);
  if (days) {
    const real = new Set(byDay.keys());
    if (days.size !== real.size || [...days].some((d) => !real.has(d))) return true;
  }
  return false;
}

/** Los días que tienen horarios comunes cargados, con quién atiende. */
export function scheduledDays(schedules: Array<Range & { professional_id: string }>, names: Map<string, string>): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const s of schedules) {
    if (s.urgent_only || (s.appointment_type_ids?.length ?? 0) > 0) continue;
    const list = out.get(s.weekday) ?? [];
    const name = names.get(s.professional_id);
    if (name && !list.includes(name)) list.push(name);
    out.set(s.weekday, list);
  }
  return out;
}

export const weekdayName = (d: number) => DAYS.find(([x]) => x === d)?.[1] ?? "";
