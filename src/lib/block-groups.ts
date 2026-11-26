// Los bloqueos de agenda agrupados para leerlos de un vistazo: un renglón por período, con todos los
// profesionales que lo tienen («mar 1 dic · todo el día · Coldeira y Mininni»), en vez de uno por
// profesional y por día. Es puro (sin base) para poder probarlo.

import { zonedParts } from "./time";

type Block = { id: string; professional_id: string | null; starts_at: string; ends_at: string; reason: string | null; external_id?: string | null };

export type BlockGroup = {
  ids: string[];
  /** «Toda la clínica» o los profesionales, en orden. */
  who: string;
  /** «mar 1 dic · todo el día», «del lun 7 al vie 11 dic · todo el día» o «mar 1 dic, 14:00 a 18:00». */
  when: string;
  reason: string | null;
  /** Vienen de Smile Connect (se cambian allá). */
  fromSmile: boolean;
  startsAt: string;
};

const isMidnight = (iso: string, tz: string) => {
  const p = zonedParts(new Date(iso), tz);
  return p.hour === 0 && p.minute === 0;
};
const day = (iso: string, tz: string) => new Intl.DateTimeFormat("es-AR", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(new Date(iso)).replace(/\.$/, "").replace(",", "");
const time = (iso: string, tz: string) => new Intl.DateTimeFormat("es-AR", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
const list = (items: string[]) => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} y ${items.at(-1)}`);

function whenText(startsAt: string, endsAt: string, tz: string): string {
  if (isMidnight(startsAt, tz) && isMidnight(endsAt, tz)) {
    // Termina a las 00:00 del día siguiente: el último día bloqueado es el anterior.
    const last = new Date(new Date(endsAt).getTime() - 60_000).toISOString();
    const a = day(startsAt, tz);
    const b = day(last, tz);
    return a === b ? `${a} · todo el día` : `del ${a} al ${b} · todo el día`;
  }
  const a = day(startsAt, tz);
  const b = day(endsAt, tz);
  return a === b ? `${a}, ${time(startsAt, tz)} a ${time(endsAt, tz)}` : `del ${a}, ${time(startsAt, tz)} al ${b}, ${time(endsAt, tz)}`;
}

export function groupBlocks(blocks: Block[], proName: Map<string, string>, tz: string): BlockGroup[] {
  // 1) Mismo período y motivo: un solo renglón con todos los profesionales.
  const same = new Map<string, { ids: string[]; pros: Set<string | null>; b: Block; smile: boolean }>();
  for (const b of [...blocks].sort((x, y) => x.starts_at.localeCompare(y.starts_at))) {
    const smile = Boolean(b.external_id?.startsWith("sc:"));
    const key = [Date.parse(b.starts_at), Date.parse(b.ends_at), b.reason ?? "", smile].join("|");
    const g = same.get(key) ?? { ids: [], pros: new Set(), b, smile };
    g.ids.push(b.id);
    g.pros.add(b.professional_id);
    same.set(key, g);
  }
  // 2) Días seguidos con los mismos profesionales y motivo: un solo período.
  type Merged = { ids: string[]; pros: Set<string | null>; start: string; end: string; reason: string | null; smile: boolean };
  const merged: Merged[] = [];
  const prosKey = (s: Set<string | null>) => [...s].map(String).sort().join(",");
  for (const g of same.values()) {
    const last = merged.at(-1);
    if (last && Date.parse(last.end) === Date.parse(g.b.starts_at) && prosKey(last.pros) === prosKey(g.pros) && (last.reason ?? "") === (g.b.reason ?? "") && last.smile === g.smile && isMidnight(g.b.starts_at, tz) && isMidnight(g.b.ends_at, tz)) {
      last.ids.push(...g.ids);
      last.end = g.b.ends_at;
      continue;
    }
    merged.push({ ids: [...g.ids], pros: new Set(g.pros), start: g.b.starts_at, end: g.b.ends_at, reason: g.b.reason, smile: g.smile });
  }
  return merged.map((m) => ({
    ids: m.ids,
    who: m.pros.has(null) ? "Toda la clínica" : list([...m.pros].map((id) => proName.get(id!) ?? "Profesional").sort((a, b) => a.localeCompare(b, "es"))),
    when: whenText(m.start, m.end, tz),
    reason: m.reason,
    fromSmile: m.smile,
    startsAt: m.start,
  }));
}
