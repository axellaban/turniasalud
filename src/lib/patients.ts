import "server-only";
import { sql, type Sql, type TransactionSql } from "./db";
import { mergeMemory } from "./memory";
import { removeCalendarEvents } from "./calendar/sync";
import type { Patient } from "./types";

// Identidad del paciente más allá del número desde el que escribe.
// Una ficha es (clínica, teléfono), pero el mismo paciente puede escribir desde
// otro número o desde la demo web. Si confirma quién es con su DNI y su fecha
// de nacimiento (o su nombre, si la ficha no tiene la fecha), ese número queda
// apuntando a su ficha (patient_phones) en lugar de crear una nueva.

type Db = Sql | TransactionSql;

/** DNI con solo números; null si no parece un documento. */
export function normalizeDni(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length >= 6 && digits.length <= 11 ? digits : null;
}

const canon = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

function nameTokens(name: string | null | undefined): Set<string> {
  return new Set(
    canon(name ?? "")
      .split(/[^a-zñ]+/)
      .filter((t) => t.length >= 2),
  );
}

/**
 * ¿Es el mismo nombre? Hacen falta dos palabras en común (nombre y apellido),
 * o una si los dos nombres tienen una sola. «Mariano Mininni» = «Mariano
 * Osvaldo Mininni»; «Montes» solo no alcanza para «Juan Carlos Montes».
 */
export function namesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.size || !tb.size) return false;
  const common = [...ta].filter((t) => tb.has(t)).length;
  return common >= Math.min(2, Math.max(ta.size, tb.size));
}

/** «OSDE» = «osde», «Swiss Medical» = «swissmedical». */
export function sameCoverage(a: string | null | undefined, b: string | null | undefined): boolean {
  const key = (s: string) => canon(s).replace(/\s+/g, "");
  return Boolean(a && b && key(a) === key(b));
}

/** Celulares o ids de Telegram: números por los que se le puede volver a escribir. */
export const isReachablePhone = (phone: string) => !phone.startsWith("web-");

export type Verification = "ok" | "falta_fecha" | "falta_nombre" | "no_coincide";

/**
 * Confirma que quien habla es el de la ficha: por fecha de nacimiento si la
 * ficha la tiene; si no, por nombre y apellido.
 */
export function verifyIdentity(
  record: Pick<Patient, "birth_date" | "full_name">,
  given: { birthDate?: string | null; name?: string | null },
): Verification {
  if (record.birth_date) {
    if (!given.birthDate) return "falta_fecha";
    return given.birthDate === record.birth_date ? "ok" : "no_coincide";
  }
  if (record.full_name) {
    if (!given.name) return "falta_nombre";
    return namesMatch(given.name, record.full_name) ? "ok" : "no_coincide";
  }
  return "ok";
}

/** Ficha de este número: la propia o la de otro número del mismo paciente. */
export async function patientForPhone(db: Db, clinicId: string, phone: string): Promise<Patient | null> {
  if (!phone) return null;
  const [patient] = await db<Patient[]>`
    select p.* from patients p
    where p.clinic_id = ${clinicId}
      and (p.phone = ${phone}
        or p.id = (select pp.patient_id from patient_phones pp where pp.clinic_id = ${clinicId} and pp.phone = ${phone}))
    order by (p.phone = ${phone}) desc
    limit 1`;
  return patient ?? null;
}

/** Otro número que lleva a la misma ficha. */
async function linkPhone(db: Db, clinicId: string, phone: string, patient: Pick<Patient, "id" | "phone">) {
  if (!phone || phone === patient.phone) return;
  await db`
    insert into patient_phones (clinic_id, phone, patient_id) values (${clinicId}, ${phone}, ${patient.id})
    on conflict (clinic_id, phone) do update set patient_id = excluded.patient_id`;
}

/** Entre fichas repetidas, la que conviene conservar: la que tiene celular, más datos y más uso. */
export function preferredPatient<T extends Patient>(patients: T[]): T {
  const score = (p: Patient) =>
    (isReachablePhone(p.phone) ? 100 : 0) +
    [p.full_name, p.dni, p.birth_date, p.email, p.coverage, p.coverage_plan, p.member_number].filter(Boolean).length;
  return [...patients].sort(
    (a, b) =>
      score(b) - score(a) ||
      (b.last_contact_at ?? "").localeCompare(a.last_contact_at ?? "") ||
      a.created_at.localeCompare(b.created_at),
  )[0];
}

/**
 * Pasa todo lo de `drop` a `keep` (turnos, conversaciones, pedidos, lista de
 * espera, campañas y visitas), completa los datos que le faltan a `keep`, deja
 * el número de `drop` apuntando a `keep` y borra la ficha repetida.
 */
export async function mergePatientInto(tx: TransactionSql, clinicId: string, keepId: string, dropId: string): Promise<Patient> {
  const rows = await tx<Patient[]>`
    select * from patients where clinic_id = ${clinicId} and id in (${keepId}, ${dropId}) order by id for update`;
  const keep = rows.find((p) => p.id === keepId);
  const drop = rows.find((p) => p.id === dropId);
  if (!keep || !drop || keepId === dropId) throw new Error("No encontré las dos fichas para unificar.");

  await tx`update appointments set patient_id = ${keepId} where patient_id = ${dropId}`;
  await tx`update conversations set patient_id = ${keepId} where patient_id = ${dropId}`;
  await tx`update tasks set patient_id = ${keepId} where patient_id = ${dropId}`;
  await tx`update waitlist set patient_id = ${keepId} where patient_id = ${dropId}`;
  // Las que chocan con una fila igual de `keep` se van con la ficha repetida.
  await tx`
    update campaign_recipients r set patient_id = ${keepId}
    where r.patient_id = ${dropId}
      and not exists (select 1 from campaign_recipients k where k.patient_id = ${keepId} and k.campaign_id = r.campaign_id)`;
  await tx`
    update patient_visits v set patient_id = ${keepId}
    where v.patient_id = ${dropId}
      and not exists (select 1 from patient_visits k where k.patient_id = ${keepId} and k.visited_at = v.visited_at and k.service = v.service)`;
  await tx`
    update patient_phones set patient_id = ${keepId}
    where patient_id = ${dropId} and phone <> ${keep.phone}`;

  const latest = [keep.last_contact_at, drop.last_contact_at].filter(Boolean).sort().at(-1) ?? null;
  // El plan y el afiliado solo se completan si son de la misma cobertura.
  const sharesCoverage = !keep.coverage || sameCoverage(keep.coverage, drop.coverage);
  const planOf = (field: "coverage_plan" | "member_number") => keep[field] ?? (sharesCoverage ? drop[field] : null);
  const [merged] = await tx<Patient[]>`
    update patients set
      full_name = ${keep.full_name ?? drop.full_name},
      dni = ${keep.dni ?? drop.dni},
      birth_date = ${keep.birth_date ?? drop.birth_date},
      email = ${keep.email ?? drop.email},
      coverage = ${keep.coverage ?? drop.coverage},
      coverage_plan = ${planOf("coverage_plan")},
      member_number = ${planOf("member_number")},
      preferences = ${keep.preferences ?? drop.preferences},
      notes = ${keep.notes ?? drop.notes},
      memory_summary = ${mergeMemory(keep.memory_summary, drop.memory_summary)},
      contact_opt_out = ${keep.contact_opt_out || drop.contact_opt_out},
      next_control_at = ${keep.next_control_at ?? drop.next_control_at},
      next_control_reason = ${keep.next_control_at ? keep.next_control_reason : drop.next_control_reason},
      last_contact_at = ${latest}
    where id = ${keepId}
    returning *`;
  await tx`delete from patients where id = ${dropId}`;
  await linkPhone(tx, clinicId, drop.phone, merged);
  return merged;
}

export type Identification =
  | { estado: "sin_ficha" }
  | { estado: "falta_fecha" | "falta_nombre" | "no_coincide" }
  /** Este número ya es la ficha de otra persona (por ejemplo, una madre que saca turno para su hijo). */
  | { estado: "otra_persona"; patient: Patient }
  | { estado: "vinculado"; patient: Patient; unificada: boolean };

/**
 * Busca la ficha con ese DNI y, si quien habla confirma su identidad, la une
 * con este número: la ficha provisoria que se haya creado en esta conversación
 * se pasa a la del paciente y el número queda apuntando a ella.
 */
export async function identifyPatient(
  clinicId: string,
  phone: string,
  input: { dni: string; birthDate?: string | null; name?: string | null },
): Promise<Identification> {
  const dni = normalizeDni(input.dni);
  if (!dni) return { estado: "sin_ficha" };
  return sql.begin(async (tx) => {
    // Una sola identificación por DNI a la vez: dos herramientas en paralelo no se pisan.
    await tx`select pg_advisory_xact_lock(hashtext(${`paciente:${clinicId}:${dni}`}))`;
    const current = await patientForPhone(tx, clinicId, phone);
    if (current?.dni === dni) return { estado: "vinculado", patient: current, unificada: false } as const;

    const candidates = await tx<Patient[]>`
      select * from patients where clinic_id = ${clinicId} and dni = ${dni} ${current ? tx`and id <> ${current.id}` : tx``}`;
    if (!candidates.length) return { estado: "sin_ficha" } as const;

    const target = preferredPatient(candidates);
    const check = verifyIdentity(target, { birthDate: input.birthDate, name: input.name ?? current?.full_name });
    if (check !== "ok") return { estado: check } as const;

    if (current) {
      const otherPerson = (current.dni && current.dni !== dni) || (current.full_name && !namesMatch(current.full_name, target.full_name ?? input.name));
      if (otherPerson) return { estado: "otra_persona", patient: current } as const;
      const merged = await mergePatientInto(tx, clinicId, target.id, current.id);
      await linkPhone(tx, clinicId, phone, merged);
      return { estado: "vinculado", patient: merged, unificada: true } as const;
    }
    await linkPhone(tx, clinicId, phone, target);
    return { estado: "vinculado", patient: target, unificada: false } as const;
  });
}

/** Otras fichas de la clínica con el mismo DNI (para unificarlas desde el panel). */
export async function duplicatesOf(patient: Pick<Patient, "id" | "clinic_id" | "dni">): Promise<Patient[]> {
  const dni = normalizeDni(patient.dni);
  if (!dni) return [];
  const rows = await sql<Patient[]>`
    select * from patients where clinic_id = ${patient.clinic_id} and dni = ${dni} and id <> ${patient.id}
    order by created_at`;
  return [...rows];
}

/** Panel: une en `keepId` todas las fichas de la clínica que tienen su mismo DNI. */
export async function mergeDuplicates(clinicId: string, keepId: string): Promise<number> {
  return sql.begin(async (tx) => {
    const [keep] = await tx<Patient[]>`select * from patients where id = ${keepId} and clinic_id = ${clinicId} for update`;
    const dni = normalizeDni(keep?.dni);
    if (!keep || !dni) return 0;
    const others = await tx<Array<{ id: string }>>`
      select id from patients where clinic_id = ${clinicId} and dni = ${dni} and id <> ${keepId} order by created_at`;
    for (const other of others) await mergePatientInto(tx, clinicId, keepId, other.id);
    return others.length;
  });
}

/**
 * Panel: borra fichas de la clínica con todo lo suyo (turnos, conversaciones,
 * pedidos, lista de espera, campañas, visitas y otros números). Antes saca del
 * calendario los eventos de sus turnos.
 */
export async function deletePatients(clinicId: string, ids: string[]): Promise<{ borradas: number; eventosSinSacar: number }> {
  if (!ids.length) return { borradas: 0, eventosSinSacar: 0 };
  const appointments = await sql<Array<{ id: string }>>`
    select a.id from appointments a join patients p on p.id = a.patient_id
    where p.clinic_id = ${clinicId} and p.id = any(${ids}::uuid[])`;
  const eventosSinSacar = await removeCalendarEvents(clinicId, appointments.map((a) => a.id));
  const borradas = await sql.begin(async (tx) => {
    await tx`delete from tasks where clinic_id = ${clinicId} and patient_id = any(${ids}::uuid[])`;
    await tx`delete from conversations where clinic_id = ${clinicId} and patient_id = any(${ids}::uuid[])`;
    const deleted = await tx`delete from patients where clinic_id = ${clinicId} and id = any(${ids}::uuid[]) returning id`;
    return deleted.length;
  });
  return { borradas, eventosSinSacar };
}
