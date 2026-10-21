// Cálculo de turnos libres. Es una función pura (sin base de datos) para
// poder testearla: recibe horarios, turnos ocupados y devuelve opciones.

import { addDaysKey, humanSlot, timeToMinutes, weekdayOfKey, zonedParts, zonedTimeToUtc } from "./time";

export type ScheduleBlock = {
  professional_id: string;
  weekday: number;
  start_time: string; // "09:00"
  end_time: string; // "13:00"
};

export type BusyInterval = { professional_id: string; starts_at: string; ends_at: string };

export type Slot = {
  professional_id: string;
  starts_at: string;
  ends_at: string;
  label: string;
};

export type SlotQuery = {
  schedules: ScheduleBlock[];
  busy: BusyInterval[];
  /** Feriados, vacaciones y bloqueos de agenda, ya expandidos por profesional. */
  blocked?: BusyInterval[];
  durationMin: number;
  fromKey: string; // YYYY-MM-DD local
  toKey: string; // YYYY-MM-DD local, inclusive
  timeZone: string;
  now: Date;
  minLeadMinutes?: number;
  partOfDay?: "manana" | "tarde" | "cualquiera";
  limit?: number;
  perDayPerProfessional?: number;
};

const AFTERNOON_START_MIN = 13 * 60;

export function computeSlots(q: SlotQuery): Slot[] {
  const lead = q.minLeadMinutes ?? 60;
  const limit = q.limit ?? 8;
  const perDay = q.perDayPerProfessional ?? 3;
  const earliest = q.now.getTime() + lead * 60_000;
  const step = q.durationMin;

  const busyByProfessional = new Map<string, Array<[number, number]>>();
  for (const b of [...q.busy, ...(q.blocked ?? [])]) {
    const list = busyByProfessional.get(b.professional_id) ?? [];
    list.push([new Date(b.starts_at).getTime(), new Date(b.ends_at).getTime()]);
    busyByProfessional.set(b.professional_id, list);
  }

  const candidates: Slot[] = [];
  for (let key = q.fromKey; key <= q.toKey; key = addDaysKey(key, 1)) {
    const weekday = weekdayOfKey(key);
    const [y, m, d] = key.split("-").map(Number);
    const perDayCount = new Map<string, number>();

    const blocks = q.schedules
      .filter((s) => s.weekday === weekday)
      .sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time));

    for (const block of blocks) {
      const blockStart = timeToMinutes(block.start_time);
      const blockEnd = timeToMinutes(block.end_time);
      for (let minute = blockStart; minute + q.durationMin <= blockEnd; minute += step) {
        if (q.partOfDay === "manana" && minute >= AFTERNOON_START_MIN) continue;
        if (q.partOfDay === "tarde" && minute < AFTERNOON_START_MIN) continue;

        const start = zonedTimeToUtc(y, m, d, Math.floor(minute / 60), minute % 60, q.timeZone);
        const startMs = start.getTime();
        const endMs = startMs + q.durationMin * 60_000;
        if (startMs < earliest) continue;

        const busy = busyByProfessional.get(block.professional_id) ?? [];
        if (busy.some(([bs, be]) => startMs < be && endMs > bs)) continue;

        const count = perDayCount.get(block.professional_id) ?? 0;
        if (count >= perDay) continue;
        perDayCount.set(block.professional_id, count + 1);

        candidates.push({
          professional_id: block.professional_id,
          starts_at: start.toISOString(),
          ends_at: new Date(endMs).toISOString(),
          label: humanSlot(start, q.timeZone),
        });
      }
    }
    if (candidates.length >= limit * 3) break;
  }

  candidates.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return candidates.slice(0, limit);
}

/** ¿Este horario exacto sigue libre? Se usa antes de reservar (doble chequeo junto a la constraint de la base). */
export function isSlotFree(
  schedules: ScheduleBlock[],
  busy: BusyInterval[],
  startsAt: Date,
  durationMin: number,
  timeZone: string,
  blocked: BusyInterval[] = [],
): { ok: true } | { ok: false; reason: string } {
  const startMs = startsAt.getTime();
  const endMs = startMs + durationMin * 60_000;
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(startsAt);
  const get = (t: string) => local.find((p) => p.type === t)?.value ?? "0";
  const key = `${get("year")}-${get("month")}-${get("day")}`;
  const minute = Number(get("hour")) * 60 + Number(get("minute"));
  const weekday = weekdayOfKey(key);

  const fits = schedules.some(
    (s) =>
      s.weekday === weekday &&
      minute >= timeToMinutes(s.start_time) &&
      minute + durationMin <= timeToMinutes(s.end_time),
  );
  if (!fits) return { ok: false, reason: "El profesional no atiende en ese horario." };
  const overlaps = (b: BusyInterval) => startMs < new Date(b.ends_at).getTime() && endMs > new Date(b.starts_at).getTime();
  if (blocked.some(overlaps)) return { ok: false, reason: "Ese día no se atiende (feriado, vacaciones o agenda bloqueada)." };
  if (busy.some(overlaps)) return { ok: false, reason: "Ese horario ya está ocupado." };
  return { ok: true };
}

/** Expande feriados y bloqueos a intervalos por profesional (sin profesional = todos). */
export function expandBlocks(
  blocks: Array<{ professional_id: string | null; starts_at: string; ends_at: string }>,
  professionalIds: string[],
): BusyInterval[] {
  return blocks.flatMap((b) =>
    (b.professional_id ? [b.professional_id] : professionalIds)
      .filter((id) => professionalIds.includes(id))
      .map((id) => ({ professional_id: id, starts_at: b.starts_at, ends_at: b.ends_at })),
  );
}

/** ¿Hay algún profesional atendiendo ahora? Sirve para saber si la clínica está en horario. */
export function isOpenAt(schedules: ScheduleBlock[], blocked: BusyInterval[], at: Date, timeZone: string): boolean {
  const p = zonedParts(at, timeZone);
  const minute = p.hour * 60 + p.minute;
  const ms = at.getTime();
  return schedules.some(
    (s) =>
      s.weekday === p.weekday &&
      minute >= timeToMinutes(s.start_time) &&
      minute < timeToMinutes(s.end_time) &&
      !blocked.some((b) => b.professional_id === s.professional_id && ms >= new Date(b.starts_at).getTime() && ms < new Date(b.ends_at).getTime()),
  );
}
