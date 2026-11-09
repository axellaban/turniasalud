// El selector de clínicas del panel (solo el equipo de Turnia lo ve). Puro: lo usan el panel y los tests.
import { formatDateTime } from "@/lib/time";

export type ClinicOption = { id: string; label: string; group?: string };
/** Una clínica con lo que hace falta para ubicarla: si es una demo, de qué persona de la prospección es y si habló con Sofi. */
export type ClinicRow = { id: string; name: string; created_at: string; is_demo: boolean; retained: boolean; person: string | null; spoke: boolean };

export const CLINIC_GROUPS = {
  clinicas: "Clínicas",
  prospeccion: "Demos de la prospección · una por persona",
  otras: "Otras demos y pruebas",
} as const;

/**
 * Las opciones del selector, en tres grupos: las clínicas (las principales y las demos conservadas), las
 * demos de la prospección y las demás demos (las de «Probá con tu web» y las pruebas). Cada vez que alguien
 * toca la esfera de su demo se arma una clínica nueva: de la prospección queda una por persona, la última en
 * la que habló con Sofi (o la última, si no habló), con cuántas armó. La que está abierta siempre figura.
 */
export function clinicOptions(rows: ClinicRow[], current: string, timezone: string): ClinicOption[] {
  const when = (row: ClinicRow) => formatDateTime(row.created_at, timezone);
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.name, (counts.get(row.name) ?? 0) + 1);
  const dated = (row: ClinicRow) => (counts.get(row.name)! > 1 ? ` · ${when(row)} · ${row.id.slice(0, 8)}` : "");
  const byLabel = (a: ClinicOption, b: ClinicOption) => a.label.localeCompare(b.label, "es");

  const clinicas: ClinicOption[] = rows
    .filter((r) => !r.is_demo || r.retained)
    .map((r) => ({ id: r.id, label: `${r.name}${!r.is_demo ? " · principal" : " · conservada"}${dated(r)}`, group: CLINIC_GROUPS.clinicas }));
  const demos = rows.filter((r) => r.is_demo && !r.retained);
  const people = new Map<string, ClinicRow[]>();
  for (const r of demos) if (r.person) people.set(r.person, [...(people.get(r.person) ?? []), r]);
  const prospeccion: ClinicOption[] = [];
  // Por persona; la abierta va justo después de la elegida para esa persona.
  for (const [person, list] of [...people].sort(([a], [b]) => a.localeCompare(b, "es"))) {
    const newest = [...list].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const pick = newest.find((r) => r.spoke) ?? newest[0];
    const spoke = list.some((r) => r.spoke);
    prospeccion.push({
      id: pick.id,
      label: `${person} · ${spoke ? "habló con Sofi" : "no habló con Sofi"}${list.length > 1 ? ` · ${list.length} demos` : ""}`,
      group: CLINIC_GROUPS.prospeccion,
    });
    // La que está abierta, aunque no sea la elegida para esa persona.
    const open = list.find((r) => r.id === current && r.id !== pick.id);
    if (open) prospeccion.push({ id: open.id, label: `${person} · demo del ${when(open)}`, group: CLINIC_GROUPS.prospeccion });
  }
  const otras: ClinicOption[] = demos.filter((r) => !r.person).map((r) => ({ id: r.id, label: `${r.name}${dated(r)}`, group: CLINIC_GROUPS.otras }));
  return [...clinicas.sort(byLabel), ...prospeccion, ...otras.sort(byLabel)];
}
