import "server-only";
import { sql } from "./db";
import { DENTAL_SPECIALTY, DENTAL_TEMPLATE } from "./agent/modules/odontologia";
import { normalizeLabel } from "./booking-rules";

/**
 * La especialidad con la que se cargan las prestaciones de la plantilla: la de los profesionales
 * odontológicos de la clínica (así los atienden sin marcar nada), o «Odontología».
 */
export async function dentalSpecialtyFor(clinicId: string): Promise<string> {
  const [row] = await sql<Array<{ specialty: string }>>`
    select specialty from professionals
    where clinic_id = ${clinicId} and active and specialty ~* '(odont|dental)'
    group by specialty order by count(*) desc, specialty limit 1`;
  return row?.specialty ?? DENTAL_SPECIALTY;
}

/**
 * Suma las prestaciones de la plantilla odontológica que la clínica todavía no tiene (por nombre).
 * No cambia ni borra las que ya están. Devuelve cuántas sumó.
 */
export async function applyDentalTemplate(clinicId: string, specialty?: string): Promise<number> {
  const spec = specialty ?? (await dentalSpecialtyFor(clinicId));
  return sql.begin(async (tx) => {
    // Dos clics seguidos no cargan la plantilla dos veces.
    await tx`select id from clinics where id = ${clinicId} for update`;
    const existing = await tx<Array<{ id: string; name: string }>>`select id, name from appointment_types where clinic_id = ${clinicId}`;
    const byName = new Map(existing.map((t) => [normalizeLabel(t.name), t.id]));
    let added = 0;
    for (const t of DENTAL_TEMPLATE) {
      if (byName.has(normalizeLabel(t.name))) continue;
      const [row] = await tx<Array<{ id: string }>>`
        insert into appointment_types ${tx({
          clinic_id: clinicId,
          name: t.name,
          specialty: spec,
          duration_min: t.duration_min,
          is_first_visit: t.is_first_visit ?? false,
          is_urgent: t.is_urgent ?? false,
          panel_only: t.panel_only ?? false,
          agent_can_reschedule: t.agent_can_reschedule ?? true,
          recall_months: t.recall_months ?? null,
          instructions: t.instructions ?? null,
          ask_before: t.ask_before ?? null,
          price_mode: t.price_mode ?? "referencia",
          requires_type_id: (t.requires && byName.get(normalizeLabel(t.requires))) || null,
        })}
        returning id`;
      byName.set(normalizeLabel(t.name), row.id);
      added++;
    }
    return added;
  });
}
