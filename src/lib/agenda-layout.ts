// Cálculos de la vista de calendario de la Agenda (semana o día). Funciones puras
// para poder testearlas: reciben minutos del día y devuelven posiciones.

/** Un intervalo dentro de un día, en minutos desde las 00:00 locales. */
export type Span = { start: number; end: number };

/**
 * Turnos que se superponen van lado a lado: a cada uno le toca un carril y el
 * grupo de superposición dice en cuántos carriles se divide el ancho.
 */
export function assignLanes<T extends Span>(items: T[]): Array<T & { lane: number; lanes: number }> {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Array<T & { lane: number; lanes: number }> = [];
  let group: Array<T & { lane: number; lanes: number }> = [];
  let groupEnd = -1;
  const close = () => {
    const lanes = Math.max(1, ...group.map((g) => g.lane + 1));
    for (const g of group) g.lanes = lanes;
    out.push(...group);
    group = [];
  };
  for (const item of sorted) {
    if (group.length && item.start >= groupEnd) close();
    // El primer carril libre a esta hora.
    const busy = new Set(group.filter((g) => g.end > item.start).map((g) => g.lane));
    let lane = 0;
    while (busy.has(lane)) lane++;
    group.push({ ...item, lane, lanes: 1 });
    groupEnd = Math.max(groupEnd, item.end);
  }
  if (group.length) close();
  return out;
}

/** Une intervalos que se tocan o se superponen. */
export function mergeSpans(spans: Span[]): Span[] {
  const sorted = [...spans].filter((s) => s.end > s.start).sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

/** Minutos de `a` que no caen en `b` (lo abierto menos lo bloqueado). */
export function subtractSpans(a: Span[], b: Span[]): Span[] {
  let rest = mergeSpans(a);
  for (const cut of mergeSpans(b)) {
    rest = rest.flatMap((s) => {
      if (cut.end <= s.start || cut.start >= s.end) return [s];
      const parts: Span[] = [];
      if (cut.start > s.start) parts.push({ start: s.start, end: cut.start });
      if (cut.end < s.end) parts.push({ start: cut.end, end: s.end });
      return parts;
    });
  }
  return rest;
}

const total = (spans: Span[]) => spans.reduce((sum, s) => sum + s.end - s.start, 0);

/** Minutos de atención (sin lo bloqueado) y cuántos de ellos tienen turno. */
export function bookedMinutes(open: Span[], blocked: Span[], booked: Span[]): { available: number; booked: number } {
  const available = subtractSpans(open, blocked);
  const inside = mergeSpans(booked).flatMap((b) =>
    available.map((o) => ({ start: Math.max(o.start, b.start), end: Math.min(o.end, b.end) })).filter((s) => s.end > s.start),
  );
  return { available: total(available), booked: total(inside) };
}

/**
 * Qué tan lleno está un día: minutos con turno sobre minutos de atención
 * (sin contar lo bloqueado). null si ese día no se atiende.
 */
export function occupancy(open: Span[], blocked: Span[], booked: Span[]): number | null {
  const m = bookedMinutes(open, blocked, booked);
  return m.available ? Math.min(1, m.booked / m.available) : null;
}

/** Primera y última hora a mostrar: el horario de atención y los turnos, con un margen. */
export function visibleHours(spans: Span[], fallback: Span = { start: 8 * 60, end: 20 * 60 }): Span {
  if (!spans.length) return fallback;
  const start = Math.min(...spans.map((s) => s.start));
  const end = Math.max(...spans.map((s) => s.end));
  return { start: Math.max(0, Math.floor(start / 60) * 60), end: Math.min(24 * 60, Math.ceil(end / 60) * 60) };
}
