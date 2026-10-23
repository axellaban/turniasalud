import "server-only";
import { sql, json, type TransactionSql } from "./db";
import { buildProfile, Profile, type DemoProfile } from "./demo/profile";
import { scrapeSite, type ScrapeResult } from "./demo/scraper";

export type ClinicImport = {
  id: string; clinic_id: string; source_url: string; status: "reading" | "pending" | "applied" | "discarded" | "error";
  pages: ScrapeResult["pages"]; profile: DemoProfile | null; error: string | null; created_at: string;
};
export const IMPORT_FIELDS = {
  name: "Nombre", specialty: "Especialidad", address: "Dirección", phone: "Teléfono",
  hours_text: "Horario de atención", accepted_coverages: "Coberturas", faq: "Preguntas frecuentes", policies: "Políticas",
} as const;
export type ImportField = keyof typeof IMPORT_FIELDS;

export function profileFields(p: DemoProfile) {
  return { name: p.nombre, specialty: p.especialidad, address: p.direccion, phone: p.telefono,
    hours_text: p.horario_texto, accepted_coverages: p.coberturas,
    faq: [p.descripcion, p.preguntas_frecuentes].filter(Boolean).join("\n") || null, policies: p.politicas };
}

/** Catálogo nuevo: los anteriores se desactivan, conservando turnos e historial. */
export async function insertProfileCatalog(tx: TransactionSql, clinicId: string, p: DemoProfile): Promise<void> {
  const hours = p.horarios.length ? p.horarios : [1, 2, 3, 4, 5].map((dia) => ({ dia, desde: "09:00", hasta: "18:00" }));
  const specialties = new Map<string, string>();
  const specialty = (s: string) => {
    const key = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    if (!specialties.has(key)) specialties.set(key, s);
    return specialties.get(key)!;
  };
  const types = p.prestaciones.length ? p.prestaciones.map((t) => ({ ...t, especialidad: specialty(t.especialidad) })) : [
    { nombre: "Consulta de primera vez", especialidad: specialty(p.especialidad), duracion_min: 30, precio: null, indicaciones: null, primera_vez: true },
    { nombre: "Control", especialidad: specialty(p.especialidad), duracion_min: 20, precio: null, indicaciones: null, primera_vez: false },
  ];
  const pros = p.profesionales.map((pr) => ({ ...pr, especialidad: specialty(pr.especialidad) }));
  for (const s of new Set(types.map((t) => t.especialidad))) if (!pros.some((pr) => pr.especialidad === s)) pros.push({ nombre: `Equipo de ${s}`, especialidad: s, dias: [], bio: null });
  for (const s of new Set(pros.map((pr) => pr.especialidad))) if (!types.some((t) => t.especialidad === s)) types.push({ nombre: `Consulta de ${s}`, especialidad: s, duracion_min: 30, precio: null, indicaciones: null, primera_vez: true });
  for (const t of types) await tx`insert into appointment_types (clinic_id, name, specialty, duration_min, instructions, price, is_first_visit) values (${clinicId}, ${t.nombre}, ${t.especialidad}, ${t.duracion_min}, ${t.indicaciones}, ${t.precio}, ${t.primera_vez})`;
  for (const pr of pros) {
    const [row] = await tx`insert into professionals (clinic_id, full_name, specialty, bio) values (${clinicId}, ${pr.nombre}, ${pr.especialidad}, ${pr.bio}) returning id`;
    const own = pr.dias.length ? hours.filter((h) => pr.dias.includes(h.dia)) : hours;
    for (const h of own.length ? own : pr.dias.map((dia) => ({ dia, desde: "09:00", hasta: "18:00" }))) await tx`insert into schedules (professional_id, weekday, start_time, end_time) values (${row.id}, ${h.dia}, ${h.desde}, ${h.hasta})`;
  }
}

export async function saveInitialImport(tx: TransactionSql, clinicId: string, profile: DemoProfile, site: ScrapeResult): Promise<void> {
  await tx`insert into clinic_imports (clinic_id, source_url, status, pages, profile, applied_at)
    values (${clinicId}, ${site.url}, 'applied', ${json(site.pages)}, ${json(profile)}, now())`;
}

export async function requestClinicImport(clinicId: string, website: string): Promise<string> {
  return sql.begin(async (tx) => {
    await tx`select id from clinics where id = ${clinicId} for update`;
    await tx`update clinic_imports set status = 'error', error = 'La lectura no terminó a tiempo. Podés volver a intentarlo.' where clinic_id = ${clinicId} and status = 'reading' and created_at < now() - interval '4 minutes'`;
    const [pending] = await tx`select id from clinic_imports where clinic_id = ${clinicId} and status = 'reading'`;
    if (pending) return pending.id as string;
    const [{ count }] = await tx`select count(*)::int as count from clinic_imports where clinic_id = ${clinicId} and created_at > now() - interval '1 hour'`;
    if (count >= 3) throw new Error("Ya se hicieron tres lecturas de esta clínica en la última hora. Probá más tarde.");
    await tx`update clinics set retained_at = coalesce(retained_at, now()) where id = ${clinicId}`;
    const [row] = await tx`insert into clinic_imports (clinic_id, source_url, status) values (${clinicId}, ${website}, 'reading') returning id`;
    return row.id as string;
  });
}

export async function readClinicImport(id: string): Promise<void> {
  const [row] = await sql<ClinicImport[]>`update clinic_imports set started_at = now() where id = ${id} and status = 'reading' and started_at is null returning *`;
  if (!row) return;
  try {
    const site = await scrapeSite(row.source_url);
    const profile = await buildProfile(site);
    await sql`update clinic_imports set status = 'pending', pages = ${json(site.pages)}, profile = ${json(profile)} where id = ${id} and status = 'reading'`;
  } catch {
    await sql`update clinic_imports set status = 'error', error = 'No se pudo leer la web. Revisá la URL y volvé a intentar.' where id = ${id} and status = 'reading'`;
  }
}

export async function applyClinicImport(clinicId: string, importId: string, fields: string[], revision: number): Promise<void> {
  const selected = fields.filter((f): f is ImportField | "catalog" => f === "catalog" || f in IMPORT_FIELDS);
  if (!selected.length) throw new Error("Elegí al menos un dato para aplicar.");
  await sql.begin(async (tx) => {
    const [clinic] = await tx`select context_revision from clinics where id = ${clinicId} for update`;
    if (!clinic || clinic.context_revision !== revision) throw new Error("El perfil cambió después de abrir esta revisión. Recargá y compará los datos de nuevo.");
    const [row] = await tx<ClinicImport[]>`select * from clinic_imports where id = ${importId} and clinic_id = ${clinicId} and status = 'pending' for update`;
    const parsed = Profile.safeParse(row?.profile);
    if (!row || !parsed.success) throw new Error("Esta propuesta ya no está disponible.");
    const values = profileFields(parsed.data);
    const changes = Object.fromEntries(selected.filter((f): f is ImportField => f !== "catalog").map((f) => [f, values[f]]));
    if (Object.keys(changes).length) await tx`update clinics set ${tx(changes)} where id = ${clinicId}`;
    if (selected.includes("catalog")) {
      await tx`update professionals set active = false where clinic_id = ${clinicId}`;
      await tx`update appointment_types set active = false where clinic_id = ${clinicId}`;
      await insertProfileCatalog(tx, clinicId, parsed.data);
    }
    await tx`update clinics set retained_at = coalesce(retained_at, now()), updated_at = now(), context_revision = context_revision + 1 where id = ${clinicId}`;
    await tx`update clinic_imports set status = 'applied', applied_at = now() where id = ${row.id}`;
  });
}
