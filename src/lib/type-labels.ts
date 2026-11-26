// Nombres de prestaciones para los selectores. Si dos se llaman igual (por ejemplo, dos «Turno Smile
// Connect» que creó la sincronización), se distinguen por especialidad y, si hace falta, por duración.

type T = { id: string; name: string; specialty?: string | null; duration_min?: number | null };

export function typeLabels(types: T[]): Map<string, string> {
  const count = (key: (t: T) => string) => {
    const m = new Map<string, number>();
    for (const t of types) m.set(key(t), (m.get(key(t)) ?? 0) + 1);
    return m;
  };
  const byName = count((t) => t.name.trim().toLowerCase());
  const bySpecialty = count((t) => `${t.name.trim().toLowerCase()}|${t.specialty ?? ""}`);
  const out = new Map<string, string>();
  for (const t of types) {
    if ((byName.get(t.name.trim().toLowerCase()) ?? 0) < 2) { out.set(t.id, t.name); continue; }
    const extra = [t.specialty, (bySpecialty.get(`${t.name.trim().toLowerCase()}|${t.specialty ?? ""}`) ?? 0) > 1 && t.duration_min ? `${t.duration_min} min` : null].filter(Boolean);
    out.set(t.id, extra.length ? `${t.name} (${extra.join(" · ")})` : t.name);
  }
  return out;
}
