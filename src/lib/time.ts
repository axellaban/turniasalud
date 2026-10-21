// Helpers de fecha/hora con zona horaria explícita. En el servidor (Vercel)
// el reloj está en UTC, así que nunca usamos la hora local del proceso.

export const DEFAULT_TZ = "America/Argentina/Buenos_Aires";

type Parts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function zonedParts(date: Date, timeZone: string): Parts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const map: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) map[part.type] = part.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    weekday: WEEKDAYS[map.weekday],
  };
}

function offsetMs(utcMs: number, timeZone: string): number {
  const p = zonedParts(new Date(utcMs), timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return asUtc - Math.floor(utcMs / 60000) * 60000;
}

/** Convierte una hora "de reloj" en la zona dada (ej. 10:30 en Buenos Aires) a un instante UTC. */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let result = guess - offsetMs(guess, timeZone);
  // Segunda pasada por si el offset cambia (horario de verano en otras zonas).
  result = guess - offsetMs(result, timeZone);
  return new Date(result);
}

/** Fecha local (YYYY-MM-DD) de un instante en la zona dada. */
export function localDateKey(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Suma días a una fecha YYYY-MM-DD (aritmética de calendario, sin zona). */
export function addDaysKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function weekdayOfKey(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function parseDateKey(value: string | undefined | null): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

/** "martes 28/10 a las 10:30" — formato pensado para que el agente lo lea en voz alta. */
export function humanSlot(date: Date, timeZone: string): string {
  const weekday = new Intl.DateTimeFormat("es-AR", { timeZone, weekday: "long" }).format(date);
  const dayMonth = new Intl.DateTimeFormat("es-AR", { timeZone, day: "numeric", month: "numeric" }).format(date);
  const time = new Intl.DateTimeFormat("es-AR", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  return `${weekday} ${dayMonth} a las ${time}`;
}

export function formatDateTime(value: string | Date, timeZone: string = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

export function formatTime(value: string | Date, timeZone: string = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat("es-AR", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    new Date(value),
  );
}

export function formatDate(value: string | Date, timeZone: string = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat("es-AR", { timeZone, day: "numeric", month: "short", year: "numeric" }).format(
    new Date(value),
  );
}

export function timeToMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + (m || 0);
}
