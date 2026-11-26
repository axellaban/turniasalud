// Feriados nacionales de la Argentina para cargarlos como bloqueos de toda la clínica. Vienen de
// ArgentinaDatos (api.argentinadatos.com, datos públicos del calendario oficial). Los puentes
// turísticos son no laborables (el consultorio puede atender): se cargan solo si se piden.

export type Holiday = { date: string; name: string; kind: "inamovible" | "trasladable" | "puente" | string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function fetchArgentineHolidays(year: number, fetcher: typeof fetch = fetch): Promise<Holiday[]> {
  const res = await fetcher(`https://api.argentinadatos.com/v1/feriados/${year}`, { signal: AbortSignal.timeout(8_000), cache: "no-store" });
  if (!res.ok) throw new Error(`No se pudo leer el calendario de feriados de ${year} (${res.status}).`);
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) throw new Error(`El calendario de feriados de ${year} vino vacío.`);
  return data
    .filter((h): h is { fecha: string; nombre?: string; tipo?: string } => typeof h?.fecha === "string" && DATE.test(h.fecha))
    .map((h) => ({ date: h.fecha, name: (h.nombre ?? "Feriado").trim().slice(0, 120) || "Feriado", kind: h.tipo ?? "inamovible" }));
}

/** Los que faltan cargar: desde hoy, hasta `until`, sin los que ya están, y sin puentes si no se piden. */
export function holidaysToLoad(list: Holiday[], opts: { today: string; until: string; loaded: Set<string>; bridges: boolean }): Holiday[] {
  const seen = new Set<string>();
  return list
    .filter((h) => h.date >= opts.today && h.date <= opts.until && !opts.loaded.has(h.date) && (opts.bridges || h.kind !== "puente"))
    .filter((h) => (seen.has(h.date) ? false : (seen.add(h.date), true)))
    .sort((a, b) => a.date.localeCompare(b.date));
}
