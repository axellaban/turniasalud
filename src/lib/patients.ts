import { appointmentAccessKey, grantAppointmentAccess } from "./agent/appointment-access";
import "server-only";
import { sql, type Sql, type TransactionSql } from "./db";
import { mergeMemory } from "./memory";
import { removeCalendarEvents } from "./calendar/sync";
import type { Patient } from "./types";

// Identidad del paciente más allá del número desde el que escribe.
// El mismo paciente puede escribir desde otro número o desde la demo web: si
// confirma quién es con su DNI y su nombre y apellido (o su fecha de nacimiento,
// si el nombre no coincide), ese número queda apuntando a su ficha
// (patient_phones) en lugar de crear una nueva.
// Un celular también puede ser de varias fichas (una madre y sus hijos): el
// número habla por una de ellas por vez, la última que se eligió (patient_phones)
// o, si nunca se eligió, la de más uso. buscar_paciente con el DNI de otra pasa a
// esa ficha.

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
export const isReachablePhone = (phone: string | null | undefined): phone is string => Boolean(phone) && !phone!.startsWith("web-");

export type Verification = "ok" | "falta_fecha" | "falta_nombre" | "no_coincide";

/**
 * Confirma que quien habla es el de la ficha, como lo haría la recepción: con
 * el DNI y el nombre y apellido alcanza. La fecha de nacimiento es la segunda
 * oportunidad cuando el nombre no coincide (un apodo, un segundo nombre) o
 * cuando la ficha no tiene nombre.
 */
export function verifyIdentity(
  record: Pick<Patient, "birth_date" | "full_name">,
  given: { birthDate?: string | null; name?: string | null },
): Verification {
  if (!record.full_name && !record.birth_date) return "ok";
  if (record.full_name && given.name && namesMatch(given.name, record.full_name)) return "ok";
  if (record.birth_date && given.birthDate === record.birth_date) return "ok";
  if (record.full_name && !given.name) return "falta_nombre";
  if (record.birth_date && !given.birthDate) return "falta_fecha";
  return "no_coincide";
}

/**
 * Ficha de este número: la que el número eligió (otro número del mismo paciente,
 * o el familiar con el que se está hablando en un celular compartido) o, si no,
 * una de las que tienen este celular: la del último contacto y, sin contactos,
 * la de más edad (suele ser el dueño del celular).
 */
export async function patientForPhone(db: Db, clinicId: string, phone: string): Promise<Patient | null> {
  if (!phone) return null;
  const [patient] = await db<Patient[]>`
    select p.* from patients p
    left join patient_phones pp on pp.clinic_id = p.clinic_id and pp.phone = ${phone} and pp.patient_id = p.id
    where p.clinic_id = ${clinicId} and (p.phone = ${phone} or pp.id is not null)
    order by (pp.id is not null) desc, p.last_contact_at desc nulls last, p.birth_date nulls last, p.created_at, p.id
    limit 1`;
  return patient ?? null;
}

/** Las otras fichas que comparten este celular (una familia). */
export async function householdOf(db: Db, clinicId: string, phone: string | null | undefined, exceptId?: string): Promise<Array<Pick<Patient, "id" | "full_name">>> {
  if (!phone) return [];
  const rows = await db<Array<Pick<Patient, "id" | "full_name">>>`
    select id, full_name from patients
    where clinic_id = ${clinicId} and phone = ${phone} ${exceptId ? db`and id <> ${exceptId}` : db``}
    order by birth_date nulls last, created_at, id`;
  return [...rows];
}

/** De ahora en más, este número habla por esta ficha (otro número suyo, o un familiar en un celular compartido). */
export async function choosePatientForPhone(db: Db, clinicId: string, phone: string, patientId: string): Promise<void> {
  if (!phone) return;
  await db`
    insert into patient_phones (clinic_id, phone, patient_id) values (${clinicId}, ${phone}, ${patientId})
    on conflict (clinic_id, phone) do update set patient_id = excluded.patient_id`;
}

/**
 * Antes de escribirle a un paciente (campaña, recordatorio, respuesta del equipo): si su celular es
 * de varias fichas, lo que responda va a la suya.
 */
export async function speakAsPatient(clinicId: string, phone: string, patientId: string): Promise<void> {
  const [row] = await sql<Array<{ fichas: number; propia: boolean | null }>>`
    select count(*)::int as fichas, bool_or(id = ${patientId}) as propia from patients where clinic_id = ${clinicId} and phone = ${phone}`;
  if (row.fichas > 1 || !row.propia) await choosePatientForPhone(sql, clinicId, phone, patientId);
}

/** Otro número que lleva a la misma ficha. */
async function linkPhone(db: Db, clinicId: string, phone: string | null, patient: Pick<Patient, "id" | "phone">) {
  if (!phone || phone === patient.phone) return;
  await choosePatientForPhone(db, clinicId, phone, patient.id);
}

/**
 * La ficha de este número o, si no tiene, una nueva. Dos herramientas que crean al mismo paciente
 * en paralelo no generan dos fichas: el número se bloquea mientras se busca y se crea.
 */
export async function findOrCreatePatientForPhone(
  clinicId: string,
  phone: string,
  data: { name?: string | null; contacted?: boolean } = {},
): Promise<{ patient: Patient; created: boolean }> {
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${`paciente-tel:${clinicId}:${phone}`}, 0))`;
    const existing = await patientForPhone(tx, clinicId, phone);
    if (existing) return { patient: existing, created: false };
    const [created] = await tx<Patient[]>`
      insert into patients (clinic_id, phone, full_name, last_contact_at)
      values (${clinicId}, ${phone}, ${data.name ?? null}, ${data.contacted ? new Date().toISOString() : null})
      returning *`;
    return { patient: created, created: true };
  });
}

/**
 * Otra persona que usa el mismo celular (un hijo, la pareja): una ficha aparte con ese número,
 * que pasa a ser con la que se habla desde ese número.
 */
export async function addHouseholdMember(
  clinicId: string,
  phone: string,
  data: Partial<Pick<Patient, "full_name" | "dni" | "birth_date" | "email" | "coverage" | "coverage_plan" | "member_number">>,
): Promise<Patient> {
  return sql.begin(async (tx) => {
    const [created] = await tx<Patient[]>`
      insert into patients ${tx({ clinic_id: clinicId, phone, last_contact_at: new Date().toISOString(), ...data })}
      returning *`;
    await choosePatientForPhone(tx, clinicId, phone, created.id);
    return created;
  });
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
  await tx`update patient_documents set patient_id = ${keepId} where patient_id = ${dropId}`;
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
  await tx`
    update patient_external_ids set patient_id = ${keepId}
    where clinic_id = ${clinicId} and patient_id = ${dropId}`;

  const latest = [keep.last_contact_at, drop.last_contact_at].filter(Boolean).sort().at(-1) ?? null;
  // El plan y el afiliado solo se completan si son de la misma cobertura.
  const sharesCoverage = !keep.coverage || sameCoverage(keep.coverage, drop.coverage);
  const planOf = (field: "coverage_plan" | "member_number") => keep[field] ?? (sharesCoverage ? drop[field] : null);
  const [merged] = await tx<Patient[]>`
    update patients set
      full_name = ${keep.full_name ?? drop.full_name},
      -- Una ficha sin celular (de una importación) toma el de la repetida.
      phone = ${keep.phone ?? drop.phone},
      dni = ${keep.dni ?? drop.dni},
      sex = ${keep.sex ?? drop.sex},
      address = ${keep.address ?? drop.address},
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
  | { estado: "falta_fecha" | "falta_nombre" | "no_coincide" | "verificacion_manual" }
  /** Este número ya es la ficha de otra persona (por ejemplo, una madre que saca turno para su hijo). */
  | { estado: "otra_persona"; patient: Patient }
  /** familiar: es otra ficha del mismo celular (la conversación pasó a la suya). */
  | { estado: "vinculado"; patient: Patient; unificada: boolean; familiar?: boolean; soloTurnos?: boolean };

/**
 * Busca la ficha con ese DNI y, si quien habla confirma su identidad, la une
 * con este número: la ficha provisoria que se haya creado en esta conversación
 * se pasa a la del paciente y el número queda apuntando a ella.
 */
export async function identifyPatient(
  clinicId: string,
  phone: string,
  input: { dni: string; birthDate?: string | null; name?: string | null; appointmentConversationId?: string },
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
    const accessKey = appointmentAccessKey({ clinicId, patientPhone: phone, conversationId: input.appointmentConversationId });
    if (accessKey && target.phone !== phone) {
      // Un permiso temporal para turnos nunca elige ni fusiona fichas para este teléfono.
      // En una línea ya asociada a otra ficha, exigimos los tres datos del paciente.
      if (!input.name) return { estado: "falta_nombre" } as const;
      if (!namesMatch(input.name, target.full_name)) return { estado: "no_coincide" } as const;
      if (current) {
        if (!target.birth_date) return { estado: "verificacion_manual" } as const;
        if (!input.birthDate) return { estado: "falta_fecha" } as const;
        if (input.birthDate !== target.birth_date) return { estado: "no_coincide" } as const;
      }
      await grantAppointmentAccess(tx, accessKey, target.id);
      return { estado: "vinculado", patient: target, unificada: false, soloTurnos: true } as const;
    }
    const check = verifyIdentity(target, { birthDate: input.birthDate, name: input.name ?? current?.full_name });
    if (check !== "ok") return { estado: check } as const;

    if (current) {
      // Un alias de la sesión web sin DNI es una ficha provisoria. Después de
      // verificar la identidad, un apellido mal transcripto en esa sesión no
      // debe tratarse como el titular distinto de un número telefónico real.
      const provisionalWeb = phone.startsWith("web-") && current.phone === phone && !current.dni;
      const otherPerson = !provisionalWeb && (
        (current.dni && current.dni !== dni) || (current.full_name && !namesMatch(current.full_name, target.full_name ?? input.name))
      );
      if (otherPerson) {
        // Un familiar con su ficha en este mismo celular: la conversación pasa a la suya.
        if (target.phone === phone) {
          await choosePatientForPhone(tx, clinicId, phone, target.id);
          return { estado: "vinculado", patient: target, unificada: false, familiar: true } as const;
        }
        return { estado: "otra_persona", patient: current } as const;
      }
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
 * pedidos, lista de espera, campañas, visitas, fotos y otros números). Antes saca del
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
    // Las fotos que mandó, también las que llegaron antes de tener ficha (atadas solo al número).
    // Las de un familiar con el mismo celular son de su ficha y no se tocan.
    await tx`
      delete from patient_documents where clinic_id = ${clinicId} and (
        patient_id = any(${ids}::uuid[])
        or (patient_id is null and (
          phone in (select phone from patients where clinic_id = ${clinicId} and id = any(${ids}::uuid[]) and phone is not null)
          or phone in (select phone from patient_phones where clinic_id = ${clinicId} and patient_id = any(${ids}::uuid[])))))`;
    const deleted = await tx`delete from patients where clinic_id = ${clinicId} and id = any(${ids}::uuid[]) returning id`;
    return deleted.length;
  });
  return { borradas, eventosSinSacar };
}
