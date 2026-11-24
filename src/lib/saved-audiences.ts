import "server-only";
import { json, sql } from "./db";
import { audienceBreakdown, computeAudience, monthsBetween, type AudienceBreakdown } from "./campaigns";
import { describeRules, parseRules, type AudienceRules } from "./audience-rules";
import { localDateKey } from "./time";
import type { Clinic } from "./types";

// Audiencias propias guardadas por clínica (Turnia Activa · Nueva audiencia).

export type SavedAudience = { id: string; clinic_id: string; name: string; rules: AudienceRules; created_at: string; updated_at: string };

export async function listSavedAudiences(clinicId: string): Promise<SavedAudience[]> {
  const rows = await sql<Array<Omit<SavedAudience, "rules"> & { rules: unknown }>>`
    select * from saved_audiences where clinic_id = ${clinicId} order by updated_at desc limit 20`;
  return rows.flatMap((r) => {
    const rules = parseRules(r.rules);
    return rules ? [{ ...r, rules }] : [];
  });
}

export async function getSavedAudience(clinicId: string, id: string): Promise<SavedAudience | null> {
  return (await listSavedAudiences(clinicId)).find((a) => a.id === id) ?? null;
}

export async function saveAudience(clinicId: string, input: { id?: string | null; name: string; rules: AudienceRules }): Promise<string> {
  if (input.id) {
    const [row] = await sql<Array<{ id: string }>>`
      update saved_audiences set name = ${input.name}, rules = ${json(input.rules)}, updated_at = now()
      where id = ${input.id} and clinic_id = ${clinicId} returning id`;
    if (row) return row.id;
  }
  const [row] = await sql<Array<{ id: string }>>`
    insert into saved_audiences (clinic_id, name, rules) values (${clinicId}, ${input.name}, ${json(input.rules)}) returning id`;
  return row.id;
}

export async function deleteSavedAudience(clinicId: string, id: string): Promise<boolean> {
  return (await sql`delete from saved_audiences where id = ${id} and clinic_id = ${clinicId} returning id`).length > 0;
}

export type AudiencePreview = AudienceBreakdown & {
  sentence: string;
  sample: Array<{ name: string; last: string }>;
};

/** Lo que muestra la columna de la derecha mientras se arman las reglas. */
export async function previewAudience(clinic: Clinic, rules: AudienceRules): Promise<AudiencePreview> {
  const [breakdown, members, names] = await Promise.all([
    audienceBreakdown(clinic, "audiencia", rules),
    computeAudience(clinic, "audiencia", undefined, rules),
    sql<Array<{ type: string | null; professional: string | null }>>`
      select (select name from appointment_types where id = ${rules.appointmentTypeId}::uuid and clinic_id = ${clinic.id}) as type,
             (select full_name from professionals where id = ${rules.professionalId}::uuid and clinic_id = ${clinic.id}) as professional`,
  ]);
  const reachable = members.filter((m) => m.reachable).slice(0, 3);
  const ids = reachable.map((m) => m.patient_id);
  const last = ids.length
    ? await sql<Array<{ patient_id: string; last_day: string }>>`
        select patient_id, max(day)::text as last_day from (
          select a.patient_id, (a.starts_at at time zone ${clinic.timezone})::date as day from appointments a where a.patient_id = any(${ids}::uuid[]) and a.status = 'atendido'
          union all
          select v.patient_id, v.visited_at from patient_visits v where v.patient_id = any(${ids}::uuid[])
        ) h group by patient_id`
    : [];
  const today = localDateKey(new Date(), clinic.timezone);
  const lastBy = new Map(last.map((r) => [r.patient_id, r.last_day]));
  return {
    ...breakdown,
    sentence: describeRules(rules, names[0] ?? {}),
    sample: reachable.map((m) => {
      const day = lastBy.get(m.patient_id);
      const [first, surname] = (m.name ?? "Sin nombre").split(/\s+/);
      return { name: surname ? `${first} ${surname[0]}.` : first, last: day ? `última visita hace ${monthsBetween(day, today)} meses` : "sin visitas registradas" };
    }),
  };
}
