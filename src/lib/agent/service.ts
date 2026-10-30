import "server-only";
import { sql, pgErrorCode, type TransactionSql } from "../db";
import { getCatalog, getClinic, findPatientByPhone, getScheduleBlocks, isUuid, patientContextText } from "../clinic";
import { identifyPatient, normalizeDni, sameCoverage, type Identification } from "../patients";
import { computeSlots, expandBlocks, isOpenAt, isSlotFree } from "../slots";
import { env } from "../env";
import { addDaysKey, humanSlot, localDateKey, parseDateKey, weekdayOfKey, zonedParts } from "../time";
import { normalizePhone } from "../phone";
import { sendPatientMessage, whatsappReadiness } from "../whatsapp";
import { notifyN8n } from "../n8n";
import { googleBusy } from "../calendar/sync";
import type { Appointment, AppointmentSource, Clinic, Patient, Task, TaskPriority, TaskType } from "../types";

export type ToolContext = {
  clinicId: string;
  patientPhone: string;
  conversationId?: string;
  channel?: string;
};

export class ToolError extends Error {
  constructor(
    message: string,
    /** El panel puede darlo igual (fuera de horario, día bloqueado u ocupado en Google). */
    readonly forzable = false,
    /** Lo que ve el consultorio en el panel, si es más que lo que se le dice al paciente. */
    readonly panelMessage?: string,
  ) {
    super(message);
  }
}

const ACTIVE = ["confirmado", "pendiente"];

export function sourceFromChannel(channel: string | undefined, phone: string): AppointmentSource {
  if (phone.startsWith("telegram:")) return "telegram";
  const c = (channel ?? "").toLowerCase();
  if (c === "panel") return "panel";
  // El Custom Channel de ElevenLabs solo se usa para WhatsApp por WAHA.
  if (c.includes("whatsapp") || c.includes("custom")) return "whatsapp";
  if (/(twilio|sip|phone|telephon|exotel)/.test(c)) return "telefono";
  if (phone.startsWith("web-")) return "web";
  return c ? "web" : "whatsapp";
}

async function ensurePatient(ctx: ToolContext, name?: string): Promise<Patient> {
  const phone = normalizePhone(ctx.patientPhone);
  if (!phone || phone === "desconocido") throw new ToolError("No tengo el teléfono del paciente para identificarlo.");
  const existing = await findPatientByPhone(ctx.clinicId, phone);
  if (existing) {
    if (name && !existing.full_name) {
      const [updated] = await sql<Patient[]>`update patients set full_name = ${name} where id = ${existing.id} returning *`;
      return updated;
    }
    return existing;
  }
  // "on conflict" cubre dos herramientas que crean al mismo paciente en paralelo.
  const [created] = await sql<Patient[]>`
    insert into patients (clinic_id, phone, full_name, last_contact_at)
    values (${ctx.clinicId}, ${phone}, ${name ?? null}, now())
    on conflict (clinic_id, phone) do update set full_name = coalesce(patients.full_name, excluded.full_name)
    returning *`;
  return created;
}

// ---------------------------------------------------------------------------
// registrar_paciente
// ---------------------------------------------------------------------------
/** Lo que se le dice al agente cuando un DNI no se pudo unir con su ficha. */
function identificationNotice(result: Exclude<Identification, { estado: "vinculado" }>): string {
  switch (result.estado) {
    case "sin_ficha":
      return "No hay ninguna ficha con ese DNI. Si dice que ya es paciente, puede que todavía no esté cargado: explicale que vas a completar su ficha, pedí los datos que falten y guardalos con registrar_paciente. Para elegir el turno, seguí las instrucciones de la clínica para pacientes que ya vinieron.";
    case "falta_fecha":
      return "Para confirmar quién es necesito también su fecha de nacimiento. Pedísela sin decirle por qué y volvé a llamar a buscar_paciente con el DNI, el nombre y la fecha. Hasta entonces no le digas si encontraste una ficha ni le des datos de ninguna.";
    case "falta_nombre":
      return "Para confirmar quién es necesito su nombre y apellido. Pedíselos y volvé a llamar a buscar_paciente con el DNI y el nombre. Hasta entonces no le digas si encontraste una ficha ni le des datos de ninguna.";
    case "no_coincide":
      return "Los datos no coinciden con la ficha de ese DNI. No le des ningún dato de esa ficha ni le digas qué no coincide. Pedile que revise el DNI y cómo figura su nombre; si siguen sin coincidir, seguí como con un paciente sin ficha o ofrecele comunicarse con recepción.";
    case "otra_persona":
      return `Este número ya es la ficha de ${result.patient.full_name ?? "otra persona"}, y ese DNI es de otro paciente. Hoy cada número tiene una sola ficha: no cambies los datos de esta. Si quiere un turno para otra persona, creá una tarea de tipo derivacion_humana con sus datos para que recepción lo agende.`;
  }
}

type PatientSummary = { nombre: string | null; dni: string | null; cobertura: string | null; plan: string | null; numero_afiliado: string | null };

export async function registerPatient(
  ctx: ToolContext,
  input: {
    nombre_completo?: string;
    dni?: string;
    fecha_nacimiento?: string;
    email?: string;
    cobertura?: string;
    plan?: string;
    numero_afiliado?: string;
    preferencias?: string;
    no_recibir_mensajes?: boolean;
  },
): Promise<{ ok: true; mensaje: string; paciente: PatientSummary | null; ficha?: string }> {
  const phone = normalizePhone(ctx.patientPhone);
  const birthDate = parseDateKey(input.fecha_nacimiento);
  const dni = input.dni ? normalizeDni(input.dni) : null;
  const notices: string[] = [];
  if (input.dni && !dni) notices.push("El DNI no parece válido: pedíselo de nuevo, solo números.");

  // Un DNI que ya está en otra ficha no crea un paciente repetido: si confirma
  // quién es, la conversación se une a esa ficha; si no, el DNI no se guarda.
  let saveDni = Boolean(dni);
  let joined = false;
  if (dni && phone && phone !== "desconocido") {
    const current = await findPatientByPhone(ctx.clinicId, phone);
    if (current?.dni !== dni) {
      const [taken] = await sql`
        select 1 from patients where clinic_id = ${ctx.clinicId} and dni = ${dni} ${current ? sql`and id <> ${current.id}` : sql``} limit 1`;
      if (taken) {
        const result = await identifyPatient(ctx.clinicId, phone, {
          dni,
          birthDate: birthDate ?? current?.birth_date,
          name: input.nombre_completo ?? current?.full_name,
        });
        if (result.estado === "vinculado") joined = true;
        else {
          saveDni = false;
          notices.push(identificationNotice(result));
          if (result.estado === "otra_persona") return { ok: true, mensaje: notices.join(" "), paciente: null };
        }
      }
    }
  }

  const patient = await ensurePatient(ctx, joined ? undefined : input.nombre_completo);
  const patch: Partial<Patient> = { last_contact_at: new Date().toISOString() };
  if (input.nombre_completo && !(joined && patient.full_name)) patch.full_name = input.nombre_completo;
  if (dni && saveDni) patch.dni = dni;
  if (birthDate && !(joined && patient.birth_date)) patch.birth_date = birthDate;
  if (input.email) patch.email = input.email;
  if (input.cobertura) {
    patch.coverage = input.cobertura;
    // Cambió de cobertura: el plan y el afiliado de la anterior ya no valen.
    if (patient.coverage && !sameCoverage(patient.coverage, input.cobertura)) {
      patch.coverage_plan = input.plan ?? null;
      patch.member_number = input.numero_afiliado ?? null;
      if (!input.plan && !/particular/i.test(input.cobertura)) notices.push("Cambió de cobertura: pedile el plan y el número de afiliado nuevos.");
    }
  }
  if (input.plan) patch.coverage_plan = input.plan;
  if (input.numero_afiliado) patch.member_number = input.numero_afiliado;
  if (input.preferencias) patch.preferences = input.preferencias;
  if (typeof input.no_recibir_mensajes === "boolean") patch.contact_opt_out = input.no_recibir_mensajes;
  const [updated] = await sql<Patient[]>`update patients set ${sql(patch)} where id = ${patient.id} returning *`;
  const saved = updated.contact_opt_out && input.no_recibir_mensajes
    ? "Listo: no le vamos a mandar más campañas ni avisos. Los recordatorios de sus propios turnos siguen llegando."
    : joined
      ? "Ya era paciente: confirmé quién es y esta conversación quedó unida a su ficha. No le vuelvas a pedir los datos cargados; pedí solo los que faltan."
      : "Datos del paciente guardados.";
  return {
    ok: true,
    mensaje: [saved, ...notices].join(" "),
    paciente: {
      nombre: updated.full_name,
      dni: updated.dni,
      cobertura: updated.coverage,
      plan: updated.coverage_plan,
      numero_afiliado: updated.member_number,
    },
    ...(joined ? { ficha: await patientContextText(await getClinic(ctx.clinicId), updated) } : {}),
  };
}

// ---------------------------------------------------------------------------
// buscar_paciente
// ---------------------------------------------------------------------------
export async function findPatientByDni(
  ctx: ToolContext,
  input: { dni: string; fecha_nacimiento?: string; nombre_completo?: string },
) {
  const phone = normalizePhone(ctx.patientPhone);
  if (!phone || phone === "desconocido") throw new ToolError("No tengo el teléfono del paciente para identificarlo.");
  const dni = normalizeDni(input.dni);
  if (!dni) return { ok: true, encontrado: false, mensaje: "Ese DNI no parece válido. Pedíselo de nuevo, solo números." };
  const result = await identifyPatient(ctx.clinicId, phone, {
    dni,
    birthDate: parseDateKey(input.fecha_nacimiento),
    name: input.nombre_completo,
  });
  if (result.estado !== "vinculado") {
    return { ok: true, encontrado: result.estado === "sin_ficha" ? false : null, mensaje: identificationNotice(result) };
  }
  await sql`update patients set last_contact_at = now() where id = ${result.patient.id}`;
  return {
    ok: true,
    encontrado: true,
    mensaje:
      "Es paciente del consultorio y quedó identificado: esta conversación ya usa su ficha. Llamalo por su nombre (sin volver a saludar), no le vuelvas a pedir los datos cargados y pedí solo los que faltan.",
    ficha: await patientContextText(await getClinic(ctx.clinicId), result.patient),
  };
}

// ---------------------------------------------------------------------------
// consultar_disponibilidad
// ---------------------------------------------------------------------------
export async function checkAvailability(
  ctx: ToolContext,
  input: { tipo_turno_id: string; profesional_id?: string; desde?: string; hasta?: string; franja?: "manana" | "tarde" | "cualquiera" },
) {
  const clinic = await getClinic(ctx.clinicId);
  const catalog = await getCatalog(clinic.id);
  const type = catalog.appointmentTypes.find((t) => t.id === input.tipo_turno_id);
  if (!type) throw new ToolError("No encontré ese tipo de turno. Usá un id del catálogo.");

  let professionals = catalog.professionals.filter((p) => p.specialty === type.specialty);
  if (input.profesional_id) professionals = professionals.filter((p) => p.id === input.profesional_id);
  if (!professionals.length) throw new ToolError("No hay profesionales que hagan ese tipo de turno.");

  const now = new Date();
  const today = localDateKey(now, clinic.timezone);
  let fromKey = parseDateKey(input.desde) ?? today;
  if (fromKey < today) fromKey = today;
  let toKey = parseDateKey(input.hasta) ?? addDaysKey(fromKey, 14);
  if (toKey < fromKey) toKey = addDaysKey(fromKey, 14);
  if (toKey > addDaysKey(fromKey, 60)) toKey = addDaysKey(fromKey, 60);

  const proIds = professionals.map((p) => p.id);
  const rangeStart = `${addDaysKey(fromKey, -1)}T00:00:00Z`;
  const rangeEnd = `${addDaysKey(toKey, 1)}T23:59:59Z`;
  const [busy, blocks, calendar] = await Promise.all([
    sql<Array<{ professional_id: string; starts_at: string; ends_at: string }>>`
      select professional_id, starts_at, ends_at from appointments
      where professional_id = any(${proIds}::uuid[])
        and status = any(${ACTIVE}::text[])
        and ends_at >= ${rangeStart} and starts_at <= ${rangeEnd}`,
    getScheduleBlocks(clinic.id, rangeStart, rangeEnd),
    // Lo ocupado en el Google Calendar de cada profesional (si la clínica lo conectó).
    googleBusy(clinic.id, proIds, new Date(rangeStart), new Date(rangeEnd), { timeZone: clinic.timezone }),
  ]);

  const slots = computeSlots({
    schedules: catalog.schedules.filter((s) => proIds.includes(s.professional_id)),
    busy: [...busy, ...calendar],
    blocked: expandBlocks(blocks, proIds),
    durationMin: type.duration_min,
    fromKey,
    toKey,
    timeZone: clinic.timezone,
    now,
    partOfDay: input.franja,
    limit: 6,
    perDayPerProfessional: 2,
  });

  const names = new Map(professionals.map((p) => [p.id, p.full_name]));
  if (!slots.length) {
    return {
      ok: true,
      turnos: [],
      mensaje: `No hay turnos libres entre ${fromKey} y ${toKey}. Ofrecé buscar más adelante o anotar al paciente en la lista de espera.`,
    };
  }
  return {
    ok: true,
    tipo_turno: type.name,
    duracion_min: type.duration_min,
    indicaciones: type.instructions,
    turnos: slots.map((s) => ({
      profesional_id: s.professional_id,
      profesional: names.get(s.professional_id),
      inicio: s.starts_at,
      cuando: s.label,
    })),
    mensaje: "Ofrecé 2 o 3 opciones al paciente, leyendo el campo 'cuando'. Para reservar usá 'inicio' y 'profesional_id' tal cual.",
  };
}

/** Un horario libre del día, para elegirlo en el panel. */
export type DaySlot = { hora: string; inicio: string };

/**
 * Panel → Agenda → turno a mano: todos los horarios libres de un día para un
 * profesional y una prestación. A diferencia del agente, no pide anticipación
 * mínima (la secretaria puede dar un turno para dentro de un rato).
 */
export async function freeSlotsOnDay(
  clinicId: string,
  input: { tipo_turno_id: string; profesional_id: string; fecha: string; ignorar_turno_id?: string },
): Promise<{ turnos: DaySlot[]; horario: string | null; motivo: string | null }> {
  const clinic = await getClinic(clinicId);
  const catalog = await getCatalog(clinic.id);
  const type = catalog.appointmentTypes.find((t) => t.id === input.tipo_turno_id);
  const pro = catalog.professionals.find((p) => p.id === input.profesional_id);
  if (!type || !pro || pro.specialty !== type.specialty) return { turnos: [], horario: null, motivo: "Elegí la prestación y quién la atiende." };
  const dayKey = parseDateKey(input.fecha);
  if (!dayKey) return { turnos: [], horario: null, motivo: "Elegí una fecha." };
  if (dayKey < localDateKey(new Date(), clinic.timezone)) return { turnos: [], horario: null, motivo: "Ese día ya pasó." };

  const schedules = catalog.schedules.filter((s) => s.professional_id === pro.id && s.weekday === weekdayOfKey(dayKey));
  const horario = schedules.length
    ? [...schedules]
        .sort((a, b) => a.start_time.localeCompare(b.start_time))
        .map((s) => `${s.start_time.slice(0, 5)} a ${s.end_time.slice(0, 5)}`)
        .join(" y ")
    : null;
  if (!horario) return { turnos: [], horario, motivo: `${pro.full_name} no atiende ese día.` };

  const rangeStart = `${addDaysKey(dayKey, -1)}T00:00:00Z`;
  const rangeEnd = `${addDaysKey(dayKey, 1)}T23:59:59Z`;
  const [busy, blocks, calendar] = await Promise.all([
    sql<Array<{ professional_id: string; starts_at: string; ends_at: string }>>`
      select professional_id, starts_at, ends_at from appointments
      where professional_id = ${pro.id}
        and status = any(${ACTIVE}::text[])
        and ends_at >= ${rangeStart} and starts_at <= ${rangeEnd}
        ${isUuid(input.ignorar_turno_id) ? sql`and id <> ${input.ignorar_turno_id}` : sql``}`,
    getScheduleBlocks(clinic.id, rangeStart, rangeEnd),
    googleBusy(clinic.id, [pro.id], new Date(rangeStart), new Date(rangeEnd), { timeZone: clinic.timezone }),
  ]);
  const blocked = expandBlocks(blocks, [pro.id]);
  const query = {
    schedules,
    busy: [...busy, ...calendar],
    durationMin: type.duration_min,
    fromKey: dayKey,
    toKey: dayKey,
    timeZone: clinic.timezone,
    now: new Date(),
    minLeadMinutes: 0,
    limit: 500,
    perDayPerProfessional: 500,
  };
  const slots = computeSlots({ ...query, blocked });
  const turnos = slots.map((s) => {
    const p = zonedParts(new Date(s.starts_at), clinic.timezone);
    return { hora: `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`, inicio: s.starts_at };
  });
  if (turnos.length) return { turnos, horario, motivo: null };
  // Sin lugar: ¿es un feriado o bloqueo, o el día está completo?
  // Sin turnos ni Google, ¿quedaría algo? Si no, lo que cierra el día es un bloqueo.
  const onlyBlocks = blocked.length ? computeSlots({ ...query, busy: [], blocked }) : [null];
  const motivo = !onlyBlocks.length
    ? "Ese día está bloqueado (feriado, vacaciones o agenda cerrada)."
    : "No quedan horarios libres ese día.";
  return { turnos: [], horario, motivo };
}

// ---------------------------------------------------------------------------
// reservar_turno
// ---------------------------------------------------------------------------
type BookOptions = {
  /** El turno que se está moviendo: no cuenta como ocupado. */
  ignoreAppointmentId?: string;
  /** Desde el panel: darlo aunque sea fuera de horario, en un día bloqueado u ocupado en Google. */
  force?: boolean;
};

const AGAIN = " Consultá la disponibilidad de nuevo y ofrecé otra opción.";

async function assertBookable(clinic: Clinic, professionalId: string, typeId: string, startsAt: Date, opts: BookOptions = {}) {
  const catalog = await getCatalog(clinic.id);
  const type = catalog.appointmentTypes.find((t) => t.id === typeId);
  if (!type) throw new ToolError("Tipo de turno inválido.");
  const pro = catalog.professionals.find((p) => p.id === professionalId);
  if (!pro) throw new ToolError("Profesional inválido.");
  if (pro.specialty !== type.specialty) throw new ToolError(`${pro.full_name} no hace ${type.name}.`);
  if (Number.isNaN(startsAt.getTime())) throw new ToolError("La fecha de inicio no es válida. Usá el campo 'inicio' de consultar_disponibilidad.");
  if (startsAt.getTime() < Date.now()) throw new ToolError("Ese horario ya pasó.");

  const endsAt = new Date(startsAt.getTime() + type.duration_min * 60_000);
  const [busy, blocks] = await Promise.all([
    sql<Array<{ professional_id: string; starts_at: string; ends_at: string }>>`
      select professional_id, starts_at, ends_at from appointments
      where professional_id = ${pro.id}
        and status = any(${ACTIVE}::text[])
        and starts_at < ${endsAt} and ends_at > ${startsAt}
        ${opts.ignoreAppointmentId ? sql`and id <> ${opts.ignoreAppointmentId}` : sql``}`,
    getScheduleBlocks(clinic.id, startsAt, endsAt),
  ]);
  // Otro turno de Turnia en ese horario: nunca se superponen (lo asegura también la base).
  if (busy.length) throw new ToolError(`Ese horario ya está ocupado.${AGAIN}`);
  if (!opts.force) {
    const check = isSlotFree(
      catalog.schedules.filter((s) => s.professional_id === pro.id),
      [],
      startsAt,
      type.duration_min,
      clinic.timezone,
      expandBlocks(blocks, [pro.id]),
    );
    if (!check.ok) throw new ToolError(`${check.reason}${AGAIN}`, true);
    // Al reservar se consulta Google en el momento, para ese horario exacto: lo que se
    // anotó recién en el calendario del profesional también cuenta.
    const calendar = await googleBusy(clinic.id, [pro.id], startsAt, endsAt, { fresh: true, timeZone: clinic.timezone });
    const overlapping = calendar.filter((b) => new Date(b.starts_at) < endsAt && new Date(b.ends_at) > startsAt);
    // Al paciente no se le cuenta qué tiene el profesional en su calendario; al consultorio, sí.
    if (overlapping.length) throw new ToolError(`Ese horario ya está ocupado.${AGAIN}`, true, `Ese horario está ocupado en el Google Calendar de ${pro.full_name}.`);
  }
  return { type, pro, endsAt };
}

/** «osde», «OSDE » y «Osdé» son la misma cobertura. */
const coverageKey = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * ¿El profesional atiende esa cobertura? Devuelve el nombre como lo cargó la clínica.
 * Sin lista, o sin cobertura del paciente, no hay restricción.
 */
function acceptedCoverage(pro: { full_name: string; accepted_coverages: string[] | null }, coverage: string | null | undefined): string | null {
  if (!coverage?.trim()) return null;
  if (!pro.accepted_coverages?.length) return coverage.trim();
  const match = pro.accepted_coverages.find((c) => coverageKey(c) === coverageKey(coverage));
  if (!match) throw new ToolError(`${pro.full_name} no atiende por ${coverage.trim()}. Atiende: ${pro.accepted_coverages.join(", ")}.`);
  return match;
}

type PatientAppointment = { id: string; starts_at: string; ends_at: string; professional_id: string; appointment_type_id: string; professional: string; type_name: string };

/** Los turnos activos que todavía no terminaron de un paciente. */
async function upcomingOf(patientId: string): Promise<PatientAppointment[]> {
  return sql<PatientAppointment[]>`
    select a.id, a.starts_at, a.ends_at, a.professional_id, a.appointment_type_id, pr.full_name as professional, t.name as type_name
    from appointments a
    join professionals pr on pr.id = a.professional_id
    join appointment_types t on t.id = a.appointment_type_id
    where a.patient_id = ${patientId} and a.status = any(${ACTIVE}::text[]) and a.ends_at > now()
    order by a.starts_at`;
}

/** La constraint appointments_no_overlap rechazó el turno: alguien lo tomó recién. */
const isOverlapError = (error: unknown) => pgErrorCode(error) === "23P01";


type NewAppointment = Pick<
  Appointment,
  "clinic_id" | "patient_id" | "professional_id" | "appointment_type_id" | "starts_at" | "ends_at" | "status" | "source" | "coverage" | "notes"
>;

/**
 * Serializa las reservas de cada profesional dentro de la transacción: si dos
 * pacientes piden el mismo horario a la vez, el segundo espera al primero y
 * choca limpio con appointments_no_overlap. Sin esto, Postgres puede cortar a
 * uno con "deadlock detected" y el agente no sabría explicarlo. Los locks se
 * toman en orden fijo y antes de tocar filas, para no cruzarse entre sí.
 */
async function lockProfessionals(tx: TransactionSql, ids: string[]): Promise<void> {
  for (const id of [...new Set(ids)].sort()) {
    await tx`select pg_advisory_xact_lock(hashtextextended(${id}::text, 0))`;
  }
}

async function insertAppointment(tx: TransactionSql, row: NewAppointment): Promise<Appointment> {
  const [appt] = await tx<Appointment[]>`insert into appointments ${tx(row)} returning *`;
  return appt;
}

export async function bookAppointment(
  ctx: ToolContext,
  input: { tipo_turno_id: string; profesional_id: string; inicio: string; nombre_completo?: string; cobertura?: string; notas?: string },
  opts: Pick<BookOptions, "force"> = {},
) {
  const clinic = await getClinic(ctx.clinicId);
  const patient = await ensurePatient(ctx, input.nombre_completo);
  if (!patient.full_name) throw new ToolError("Antes de reservar necesito el nombre y apellido del paciente (registrar_paciente).");

  const startsAt = new Date(input.inicio);
  const mine = await upcomingOf(patient.id);
  // El mismo turno ya reservado (el agente reintentó la herramienta, o un doble clic): no es un error.
  const same = mine.find(
    (a) => a.professional_id === input.profesional_id && a.appointment_type_id === input.tipo_turno_id && new Date(a.starts_at).getTime() === startsAt.getTime(),
  );
  if (same) {
    return {
      ok: true,
      turno_id: same.id,
      mensaje: `Ese turno ya estaba reservado: ${same.type_name} con ${same.professional} el ${humanSlot(startsAt, clinic.timezone)}.`,
      direccion: clinic.address,
    };
  }

  const { type, pro, endsAt } = await assertBookable(clinic, input.profesional_id, input.tipo_turno_id, startsAt, opts);
  // Una persona no puede estar en dos turnos a la vez.
  const clash = mine.find((a) => new Date(a.starts_at) < endsAt && new Date(a.ends_at) > startsAt);
  if (clash) {
    throw new ToolError(
      `El paciente ya tiene un turno a esa hora: ${clash.type_name} con ${clash.professional} el ${humanSlot(new Date(clash.starts_at), clinic.timezone)}. Si lo quiere cambiar, usá reprogramar_turno.`,
    );
  }
  const coverage = acceptedCoverage(pro, input.cobertura || patient.coverage);

  let appt: Appointment;
  try {
    appt = await sql.begin(async (tx) => {
      await lockProfessionals(tx, [pro.id]);
      return insertAppointment(tx, {
        clinic_id: clinic.id,
        patient_id: patient.id,
        professional_id: pro.id,
        appointment_type_id: type.id,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        status: "confirmado",
        source: sourceFromChannel(ctx.channel, ctx.patientPhone),
        coverage,
        notes: input.notas ?? null,
      });
    });
  } catch (e) {
    if (isOverlapError(e)) throw new ToolError("Ese horario se acaba de ocupar. Consultá la disponibilidad de nuevo.");
    throw e;
  }

  // Si el paciente estaba en lista de espera para esto, la damos por resuelta.
  await sql`
    update waitlist set status = 'resuelta'
    where patient_id = ${patient.id} and appointment_type_id = ${type.id} and status in ('activa', 'ofrecida')`;

  await notifyN8n("turno.reservado", { clinic_id: clinic.id, appointment: appt, patient, professional: pro.full_name, type: type.name });

  // ¿Ya tenía otro turno de lo mismo? Puede ser a propósito (dos sesiones), o que quería cambiarlo.
  const other = mine.find((a) => a.appointment_type_id === type.id);
  return {
    ok: true,
    turno_id: appt.id,
    mensaje: `Turno confirmado: ${type.name} con ${pro.full_name} el ${humanSlot(startsAt, clinic.timezone)}.`,
    direccion: clinic.address,
    indicaciones: type.instructions,
    ...(other && {
      aviso: `Ya tenía otro turno de ${other.type_name} el ${humanSlot(new Date(other.starts_at), clinic.timezone)}. Preguntale si quiere mantener los dos o cancelar el otro.`,
    }),
  };
}

// ---------------------------------------------------------------------------
// ver_turnos_paciente
// ---------------------------------------------------------------------------
export async function listPatientAppointments(ctx: ToolContext) {
  const clinic = await getClinic(ctx.clinicId);
  const patient = await findPatientByPhone(clinic.id, normalizePhone(ctx.patientPhone));
  if (!patient) return { ok: true, turnos: [], mensaje: "El paciente no tiene turnos registrados." };
  const rows = await sql<
    Array<{ id: string; starts_at: string; status: string; professional_id: string; appointment_type_id: string; professional: string; type_name: string }>
  >`
    select a.id, a.starts_at, a.status, a.professional_id, a.appointment_type_id,
           pr.full_name as professional, t.name as type_name
    from appointments a
    join professionals pr on pr.id = a.professional_id
    join appointment_types t on t.id = a.appointment_type_id
    where a.patient_id = ${patient.id} and a.status = any(${ACTIVE}::text[]) and a.starts_at >= now()
    order by a.starts_at`;
  return {
    ok: true,
    turnos: rows.map((r) => ({
      turno_id: r.id,
      cuando: humanSlot(new Date(r.starts_at), clinic.timezone),
      inicio: r.starts_at,
      tipo_turno: r.type_name,
      tipo_turno_id: r.appointment_type_id,
      profesional: r.professional,
      profesional_id: r.professional_id,
      estado: r.status,
    })),
  };
}

async function getOwnAppointment(ctx: ToolContext, appointmentId: string) {
  const patient = await findPatientByPhone(ctx.clinicId, normalizePhone(ctx.patientPhone));
  if (!patient) throw new ToolError("No encontré al paciente.");
  const [appt] = isUuid(appointmentId)
    ? await sql<Appointment[]>`select * from appointments where id = ${appointmentId} and patient_id = ${patient.id}`
    : [];
  if (!appt) throw new ToolError("No encontré ese turno para este paciente. Usá ver_turnos_paciente.");
  if (!ACTIVE.includes(appt.status)) throw new ToolError(`Ese turno ya está ${appt.status}.`);
  return { patient, appt };
}

/** Panel: el turno de la clínica, con su paciente. */
async function getClinicAppointment(clinicId: string, appointmentId: string) {
  const [appt] = isUuid(appointmentId)
    ? await sql<Appointment[]>`select * from appointments where id = ${appointmentId} and clinic_id = ${clinicId}`
    : [];
  if (!appt) throw new ToolError("Ese turno ya no existe.");
  if (!ACTIVE.includes(appt.status)) throw new ToolError(`Ese turno ya está ${appt.status}.`);
  const [patient] = await sql<Patient[]>`select * from patients where id = ${appt.patient_id}`;
  return { patient, appt };
}

/** Un turno que ya terminó no se cancela ni se mueve: se marca como atendido o ausente. */
function assertNotOver(appt: Appointment) {
  if (new Date(appt.ends_at).getTime() < Date.now()) {
    throw new ToolError("Ese turno ya pasó: no se puede cancelar ni reprogramar. Si necesita otro, consultá la disponibilidad.");
  }
}

// ---------------------------------------------------------------------------
// confirmar_turno (el paciente avisa que va a venir, ej. tras un recordatorio)
// ---------------------------------------------------------------------------
export async function confirmAppointment(ctx: ToolContext, input: { turno_id: string }) {
  const clinic = await getClinic(ctx.clinicId);
  const { patient, appt } = await getOwnAppointment(ctx, input.turno_id);
  if (new Date(appt.starts_at).getTime() < Date.now()) throw new ToolError("Ese turno ya pasó.");
  await sql`update appointments set status = 'confirmado', confirmed_at = coalesce(confirmed_at, now()) where id = ${appt.id}`;
  await notifyN8n("turno.confirmado", { clinic_id: clinic.id, appointment: appt, patient });
  return {
    ok: true,
    mensaje: `Asistencia confirmada para el ${humanSlot(new Date(appt.starts_at), clinic.timezone)}. Recordale la dirección y las indicaciones previas si las hay.`,
    direccion: clinic.address,
  };
}

// ---------------------------------------------------------------------------
// cancelar_turno (+ ofrece el hueco a la lista de espera)
// ---------------------------------------------------------------------------
async function cancelLoaded(clinic: Clinic, patient: Patient, appt: Appointment, motivo: string | undefined, by: "paciente" | "clinica") {
  assertNotOver(appt);
  const notes = [appt.notes, motivo && `Cancelado: ${motivo}`].filter(Boolean).join(" | ");
  // Solo si sigue activo: si otro canal lo canceló o movió recién, no se pisa.
  const [done] = await sql`
    update appointments set status = 'cancelado', cancelled_at = now(), notes = ${notes || null}
    where id = ${appt.id} and status = any(${ACTIVE}::text[]) returning id`;
  if (!done) throw new ToolError("Ese turno ya no está activo: se canceló o se reprogramó recién.");
  await notifyN8n("turno.cancelado", { clinic_id: clinic.id, appointment: appt, patient, motivo, cancelado_por: by });
  const offered = await offerFreedSlot(clinic, appt).catch((e) => {
    console.error("No se pudo ofrecer el turno liberado", e);
    return 0;
  });
  return { when: humanSlot(new Date(appt.starts_at), clinic.timezone), offered };
}

export async function cancelAppointment(ctx: ToolContext, input: { turno_id: string; motivo?: string }) {
  const clinic = await getClinic(ctx.clinicId);
  const { patient, appt } = await getOwnAppointment(ctx, input.turno_id);
  const { when, offered } = await cancelLoaded(clinic, patient, appt, input.motivo, "paciente");
  return {
    ok: true,
    mensaje: `Turno del ${when} cancelado. Ofrecé reprogramarlo.`,
    avisados_lista_espera: offered,
  };
}

/** Panel: la clínica cancela un turno. Igual que si lo cancela el paciente: avisa a n8n y ofrece el hueco. */
export async function cancelClinicAppointment(clinicId: string, appointmentId: string, motivo?: string) {
  const clinic = await getClinic(clinicId);
  const { patient, appt } = await getClinicAppointment(clinicId, appointmentId);
  const { when, offered } = await cancelLoaded(clinic, patient, appt, motivo, "clinica");
  return {
    ok: true,
    mensaje: `Turno del ${when} cancelado.${offered ? ` Se le ofreció el horario a ${offered === 1 ? "1 persona" : `${offered} personas`} de la lista de espera.` : ""}`,
  };
}

/** Cuando se libera un turno, se lo ofrecemos por WhatsApp a quienes esperan (flujo "Activa"). */
export async function offerFreedSlot(clinic: Clinic, appt: Appointment): Promise<number> {
  if (new Date(appt.starts_at).getTime() < Date.now() + 2 * 3600_000) return 0;
  const template = clinic.templates?.lista_espera ?? (clinic.whatsapp_provider === "waha" ? "lista_espera" : null);
  if (!template || whatsappReadiness(clinic)) return 0;

  const entries = await sql<Array<{ id: string; patient_id: string; professional_id: string | null; full_name: string | null; phone: string }>>`
    select w.id, w.patient_id, w.professional_id, p.full_name, p.phone
    from waitlist w join patients p on p.id = w.patient_id
    where w.clinic_id = ${clinic.id} and w.status = 'activa' and w.appointment_type_id = ${appt.appointment_type_id}
      and w.patient_id <> ${appt.patient_id}
    order by w.created_at
    limit 10`;

  const candidates = entries
    .filter((e) => !e.professional_id || e.professional_id === appt.professional_id)
    .filter((e) => /^\d+$/.test(e.phone))
    .slice(0, 3);

  const when = humanSlot(new Date(appt.starts_at), clinic.timezone);
  let sent = 0;
  for (const entry of candidates) {
    const phone = entry.phone;
    const context = `Le escribimos para ofrecerle un turno que se liberó: ${when} (profesional_id=${appt.professional_id}, tipo_turno_id=${appt.appointment_type_id}, inicio=${appt.starts_at}). Si lo quiere, reservalo enseguida porque se ofreció a varias personas.`;
    try {
      await sendPatientMessage(clinic, {
        phone,
        templateKey: "lista_espera",
        templateName: template,
        params: [entry.full_name?.split(" ")[0] || "hola", when],
        context,
      });
      await sql`update waitlist set status = 'ofrecida', offered_at = now() where id = ${entry.id}`;
      sent++;
    } catch (e) {
      console.error("Fallo al ofrecer turno liberado", e);
    }
  }
  return sent;
}

// ---------------------------------------------------------------------------
// reprogramar_turno
// ---------------------------------------------------------------------------
async function rescheduleLoaded(
  clinic: Clinic,
  patient: Patient,
  appt: Appointment,
  input: { nuevo_inicio: string; profesional_id?: string },
  source: AppointmentSource,
  force = false,
) {
  assertNotOver(appt);
  const professionalId = input.profesional_id || appt.professional_id;
  const startsAt = new Date(input.nuevo_inicio);
  const { type, pro, endsAt } = await assertBookable(clinic, professionalId, appt.appointment_type_id, startsAt, { ignoreAppointmentId: appt.id, force });
  // Con otro profesional, que atienda la cobertura del turno.
  const coverage = pro.id === appt.professional_id ? appt.coverage : acceptedCoverage(pro, appt.coverage);
  const clash = (await upcomingOf(patient.id)).find((a) => a.id !== appt.id && new Date(a.starts_at) < endsAt && new Date(a.ends_at) > startsAt);
  if (clash) {
    throw new ToolError(`El paciente ya tiene otro turno a esa hora: ${clash.type_name} con ${clash.professional} el ${humanSlot(new Date(clash.starts_at), clinic.timezone)}.`);
  }

  // En una transacción: liberamos el turno viejo (puede superponerse con el
  // nuevo) y reservamos el nuevo. Si algo falla, el viejo queda como estaba.
  let newAppt: Appointment;
  try {
    newAppt = await sql.begin(async (tx) => {
      await lockProfessionals(tx, [appt.professional_id, pro.id]);
      const [freed] = await tx`
        update appointments set status = 'reprogramado', cancelled_at = now()
        where id = ${appt.id} and status = any(${ACTIVE}::text[]) returning id`;
      if (!freed) throw new ToolError("Ese turno ya no está activo: se canceló o se reprogramó recién.");
      return insertAppointment(tx, {
        clinic_id: clinic.id,
        patient_id: patient.id,
        professional_id: pro.id,
        appointment_type_id: type.id,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        status: "confirmado",
        source,
        coverage,
        notes: appt.notes,
      });
    });
  } catch (e) {
    if (isOverlapError(e)) throw new ToolError("Ese horario se acaba de ocupar. Consultá la disponibilidad de nuevo.");
    throw e;
  }
  await notifyN8n("turno.reprogramado", { clinic_id: clinic.id, before: appt, after: newAppt, patient });
  await offerFreedSlot(clinic, appt).catch(() => 0);
  return { turno_id: newAppt.id, mensaje: `Listo: el turno pasó al ${humanSlot(startsAt, clinic.timezone)} con ${pro.full_name}.` };
}

export async function rescheduleAppointment(ctx: ToolContext, input: { turno_id: string; nuevo_inicio: string; profesional_id?: string }) {
  const clinic = await getClinic(ctx.clinicId);
  const { patient, appt } = await getOwnAppointment(ctx, input.turno_id);
  const r = await rescheduleLoaded(clinic, patient, appt, input, sourceFromChannel(ctx.channel, ctx.patientPhone));
  return { ok: true, ...r };
}

/** Panel: la clínica mueve un turno. El turno nuevo conserva por dónde lo pidió el paciente. */
export async function rescheduleClinicAppointment(
  clinicId: string,
  appointmentId: string,
  input: { nuevo_inicio: string; profesional_id?: string },
  opts: { force?: boolean } = {},
) {
  const clinic = await getClinic(clinicId);
  const { patient, appt } = await getClinicAppointment(clinicId, appointmentId);
  const r = await rescheduleLoaded(clinic, patient, appt, input, appt.source, opts.force);
  return { ok: true, ...r };
}

// ---------------------------------------------------------------------------
// crear_tarea (recetas, consultas clínicas, derivación a una persona, urgencias)
// ---------------------------------------------------------------------------
export async function createTask(
  ctx: ToolContext,
  input: { tipo: TaskType; prioridad?: TaskPriority; titulo: string; detalle?: string },
) {
  let patientId: string | null = null;
  try {
    patientId = (await ensurePatient(ctx)).id;
  } catch {
    patientId = null;
  }
  const clinic = await getClinic(ctx.clinicId);
  const catalog = await getCatalog(clinic.id);
  const now = new Date();
  const blocks = await getScheduleBlocks(clinic.id, now, new Date(now.getTime() + 60_000));
  const openNow = isOpenAt(catalog.schedules, expandBlocks(blocks, catalog.professionals.map((p) => p.id)), now, clinic.timezone);
  const [task] = await sql<Task[]>`
    insert into tasks ${sql({
      clinic_id: clinic.id,
      patient_id: patientId,
      conversation_id: ctx.conversationId ?? null,
      type: input.tipo,
      priority: input.prioridad ?? (input.tipo === "urgencia" ? "urgente" : "normal"),
      title: input.titulo,
      details: input.detalle ?? null,
    })}
    returning *`;
  // n8n avisa a recepción con el link al panel (derivación a una persona, urgencias, recetas…).
  await notifyN8n("tarea.creada", {
    clinic_id: clinic.id,
    task,
    fuera_de_horario: !openNow,
    panel_url: `${env.appUrl().replace(/\/$/, "")}/panel/tareas`,
  });
  return {
    ok: true,
    tarea_id: task.id,
    mensaje: openNow
      ? "Tarea creada para el equipo. Avisale al paciente que lo van a contactar a la brevedad."
      : "Tarea creada para el equipo. Ahora estamos fuera del horario de atención: avisale al paciente que lo contactan apenas abramos, y si es urgente repetí las indicaciones de urgencia.",
  };
}

// ---------------------------------------------------------------------------
// anotar_lista_espera
// ---------------------------------------------------------------------------
export async function joinWaitlist(ctx: ToolContext, input: { tipo_turno_id: string; profesional_id?: string; preferencias?: string }) {
  const patient = await ensurePatient(ctx);
  const catalog = await getCatalog(ctx.clinicId);
  if (!catalog.appointmentTypes.some((t) => t.id === input.tipo_turno_id)) throw new ToolError("Tipo de turno inválido.");
  const professionalId = input.profesional_id && catalog.professionals.some((p) => p.id === input.profesional_id) ? input.profesional_id : null;
  await sql`
    insert into waitlist ${sql({
      clinic_id: ctx.clinicId,
      patient_id: patient.id,
      appointment_type_id: input.tipo_turno_id,
      professional_id: professionalId,
      preferences: input.preferencias ?? null,
    })}`;
  return { ok: true, mensaje: "Paciente anotado en la lista de espera. Si se libera un turno le escribimos por WhatsApp." };
}
