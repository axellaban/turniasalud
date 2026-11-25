import "server-only";
import { json, sql, pgErrorCode, type TransactionSql } from "../db";
import { getCatalog, getClinic, findPatientByPhone, getScheduleBlocks, isUuid, patientContextText, type Catalog } from "../clinic";
import { addHouseholdMember, findOrCreatePatientForPhone, identifyPatient, namesMatch, normalizeDni, sameCoverage, type Identification } from "../patients";
import { computeSlots, expandBlocks, isOpenAt, isSlotFree, type BusyInterval, type ScheduleBlock, type SlotQuery } from "../slots";
import { agentBookingDayAllowed, agentCanMove, agentSchedules, bookingDaysText, checkCoverage, coverageKey, durationPhrase, firstSlotOfDayBlocked, isParticular, parseTerms, professionalDoes, receptionOnlyTerm, schedulesForTypes } from "../booking-rules";
import { env } from "../env";
import { addDaysKey, formatDate, humanSlot, localDateKey, parseClockTime, parseDateKey, weekdayOfKey, zonedParts } from "../time";
import { normalizePhone } from "../phone";
import { sendPatientMessage, whatsappReadiness } from "../whatsapp";
import { notifyN8n } from "../n8n";
import { googleBusy } from "../calendar/sync";
import { getSmileApiConnection, isLiveSmileMode, smileBusy, writesEnabledOnServer } from "../smile-connect-link";
import { confirmNewSmileAppointment, processSmileBookingLater, processSmileNotesLater, settleSmileBooking } from "../smile-connect-push";
import { noticesToldInChat } from "../clinic-notices";
import { appointmentAccessEnabled, appointmentAccessKey, expireAppointmentAccess } from "./appointment-access";
import type { Appointment, AppointmentSource, AppointmentType, Clinic, Patient, SmileManagement, Task, TaskPriority, TaskType } from "../types";

import { healthFormSheet, healthFormTemplate, type HealthFormInput } from "../health-form";
import { HEALTH_FORM_VALID_DAYS, healthFormOffer, latestHealthForm, markHealthFormInvited, saveHealthFormAnswers } from "../health-forms";
import { muteNumber } from "../chat-guard";
import { CHAT_LIMITS } from "../chat-limits";
import { clinicWhatsappStatus } from "../waha-health";

export type ToolContext = {
  clinicId: string;
  patientPhone: string;
  /** Panel: la ficha elegida (en un celular compartido, el familiar para el que es el turno). */
  patientId?: string;
  /** Autorización temporal resuelta por el servidor, solo para turnos existentes. */
  appointmentPatientId?: string;
  conversationId?: string;
  channel?: string;
  /**
   * Le escribe alguien del equipo del consultorio por WhatsApp (Configuración → Consultorio →
   * Acceso total por WhatsApp): actúa como el consultorio sobre cualquier turno. Lo decide la ruta
   * de herramientas, nunca el modelo.
   */
  staff?: { name: string } | null;
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

export class SmileHandoff extends ToolError {
  constructor(message: string, readonly detail: string) {
    super(message);
  }
}

async function usesLiveSmile(clinicId: string, tx?: TransactionSql): Promise<boolean> {
  if (!writesEnabledOnServer()) return false;
  const conn = await getSmileApiConnection(clinicId, tx);
  return Boolean(conn?.api_key_encrypted && isLiveSmileMode(conn.api_mode));
}

/**
 * Lo ocupado fuera de Turnia: el Google Calendar de cada profesional y la agenda de Smile Connect.
 * Si Smile Connect falla, no frena la agenda: quedan los turnos que Turnia ya trajo de ahí.
 */
async function externalBusy(clinicId: string, ids: string[], from: Date, to: Date, opts: { fresh?: boolean; verified?: { from: string; to: string; weekdays?: number[]; unchecked?: string[] }; deferSmile?: boolean; timeZone: string; durationMin?: number; starts?: Map<string, Set<number>> }): Promise<BusyInterval[]> {
  const [google, smile] = await Promise.all([
    googleBusy(clinicId, ids, from, to, opts),
    (opts.deferSmile ? Promise.resolve([] as BusyInterval[]) : smileBusy(clinicId, ids, from, to, opts)).catch((e) => {
      console.error("Smile Connect: no se pudo leer lo ocupado", e instanceof Error ? e.message : e);
      if (opts.verified) {
        throw new SmileHandoff(
          "No pude consultar los horarios actualizados. Recepción va a revisar el pedido.",
          `Verificar disponibilidad del ${opts.verified.from} al ${opts.verified.to} (${e instanceof Error ? e.message : e}).`,
        );
      }
      if (opts.fresh) {
        throw new SmileHandoff(
          "No pude verificar ese horario con la agenda del consultorio. El pedido queda pendiente. Todavía no hay un turno confirmado.",
          `Verificar disponibilidad el ${humanSlot(from, opts.timeZone)} para el pedido del paciente.`,
        );
      }
      return [] as BusyInterval[];
    }),
  ]);
  return [...google.map((b) => ({ ...b, source: "google" as const })), ...smile];
}

/**
 * Lo que ocupa a estos profesionales: sus turnos activos, también los que atienden
 * como segundo profesional (por ejemplo, una cirugía conjunta).
 */
async function busyOf(proIds: string[], from: Date | string, to: Date | string, ignore?: string | string[]): Promise<BusyInterval[]> {
  const ignoreIds = (Array.isArray(ignore) ? ignore : [ignore]).filter((id): id is string => Boolean(id));
  const rows = await sql<Array<{ professional_id: string; second_professional_id: string | null; starts_at: string; ends_at: string }>>`
    select professional_id, second_professional_id, starts_at, ends_at from appointments
    where (professional_id = any(${proIds}::uuid[]) or second_professional_id = any(${proIds}::uuid[]))
      and status = any(${ACTIVE}::text[])
      and starts_at < ${to} and ends_at > ${from}
      ${ignoreIds.length ? sql`and id <> all(${ignoreIds}::uuid[])` : sql``}`;
  return rows.flatMap((r) =>
    [r.professional_id, r.second_professional_id]
      .filter((id): id is string => Boolean(id) && proIds.includes(id!))
      .map((id) => ({ professional_id: id, starts_at: r.starts_at, ends_at: r.ends_at })),
  );
}

export function sourceFromChannel(channel: string | undefined, phone: string): AppointmentSource {
  const c = (channel ?? "").toLowerCase();
  if (c === "panel") return "panel";
  // El Custom Channel de ElevenLabs solo se usa para WhatsApp por WAHA.
  if (c.includes("whatsapp") || c.includes("custom")) return "whatsapp";
  if (/(twilio|sip|phone|telephon|exotel)/.test(c)) return "telefono";
  if (phone.startsWith("web-")) return "web";
  return c ? "web" : "whatsapp";
}

function smileReplyPhone(ctx: ToolContext, source: AppointmentSource) {
  const phone = normalizePhone(ctx.patientPhone);
  return !ctx.staff && (source === "whatsapp" || source === "telefono") && /^\d{10,15}$/.test(phone) ? phone : null;
}

/**
 * Smile Connect por API en modo real con confirmación diferida: Sofi guarda el pedido y lo confirma
 * después de verificarlo allá, ofrece solo horarios verificados y mueve o cancela verificando el cambio.
 * Empezó en Guerra–Mininni y es el flujo por defecto de toda clínica (`api_deferred`).
 */
async function usesDeferredSmile(clinicId: string, tx?: TransactionSql): Promise<boolean> {
  if (!writesEnabledOnServer()) return false;
  const conn = await getSmileApiConnection(clinicId, tx);
  return Boolean(conn?.api_key_encrypted && isLiveSmileMode(conn.api_mode) && conn.api_deferred);
}

/** Mover y cancelar turnos de Smile Connect verificándolos allá (modo «Crear, mover y cancelar»). */
async function usesSmileManagement(clinicId: string, tx?: TransactionSql) {
  if (!writesEnabledOnServer()) return false;
  const connection = await getSmileApiConnection(clinicId, tx);
  return Boolean(connection?.api_key_encrypted && connection.api_mode === "completa" && connection.api_deferred);
}

/** La ficha con la que se está hablando: la elegida en el panel o la de este número. */
async function currentPatient(ctx: ToolContext): Promise<Patient | null> {
  if (ctx.patientId) {
    const [chosen] = isUuid(ctx.patientId) ? await sql<Patient[]>`select * from patients where id = ${ctx.patientId} and clinic_id = ${ctx.clinicId}` : [];
    if (chosen) return chosen;
  }
  const phone = normalizePhone(ctx.patientPhone);
  return phone && phone !== "desconocido" ? findPatientByPhone(ctx.clinicId, phone) : null;
}

async function appointmentPatient(ctx: ToolContext): Promise<Patient | null> {
  if (!ctx.appointmentPatientId) return currentPatient(ctx);
  const [patient] = await sql<Patient[]>`select * from patients where clinic_id = ${ctx.clinicId} and id = ${ctx.appointmentPatientId}`;
  return patient ?? null;
}

async function ensurePatient(ctx: ToolContext, name?: string): Promise<Patient> {
  const existing = await currentPatient(ctx);
  const phone = normalizePhone(ctx.patientPhone);
  if (!existing && (!phone || phone === "desconocido")) throw new ToolError("No tengo el teléfono del paciente para identificarlo.");
  // Dos herramientas que crean al mismo paciente en paralelo no generan dos fichas.
  const patient = existing ?? (await findOrCreatePatientForPhone(ctx.clinicId, phone, { name, contacted: true })).patient;
  if (name && !patient.full_name) {
    const [updated] = await sql<Patient[]>`update patients set full_name = ${name} where id = ${patient.id} returning *`;
    return updated;
  }
  return patient;
}

/**
 * ¿Los datos son de otra persona que usa este mismo celular (un hijo, la pareja)? La ficha ya tiene
 * otro DNI y el nombre no coincide: en lugar de pisarla, se registra en una ficha aparte.
 */
function isAnotherPerson(current: Patient, dni: string, name: string | undefined): boolean {
  const own = normalizeDni(current.dni);
  return Boolean(own && own !== dni && name && current.full_name && !namesMatch(name, current.full_name));
}

// ---------------------------------------------------------------------------
// registrar_paciente
// ---------------------------------------------------------------------------
/** Lo que se le dice al agente cuando un DNI no se pudo unir con su ficha. */
function identificationNotice(result: Exclude<Identification, { estado: "vinculado" }>): string {
  switch (result.estado) {
    case "sin_ficha":
      return "No hay ficha con ese DNI. Si busca un turno existente, confirmá los dígitos y volvé a buscar. Si sigue sin aparecer, ofrecé que recepción lo revise. No registres una ficha para buscar un turno existente. Si está sacando un turno nuevo, seguí el proceso de admisión de la clínica.";
    case "falta_fecha":
      return "Para confirmar quién es necesito también su fecha de nacimiento. Pedísela sin decirle por qué y volvé a llamar a buscar_paciente con el DNI, el nombre y la fecha. Hasta entonces no le digas si encontraste una ficha ni le des datos de ninguna.";
    case "falta_nombre":
      return "Para confirmar quién es necesito su nombre y apellido. Pedíselos y volvé a llamar a buscar_paciente con el DNI y el nombre. Hasta entonces no le digas si encontraste una ficha ni le des datos de ninguna.";
    case "no_coincide":
      return "Los datos no coinciden con la ficha de ese DNI. No le des ningún dato de esa ficha ni le digas qué no coincide. Pedile que revise el DNI y cómo figura su nombre; si siguen sin coincidir, seguí como con un paciente sin ficha o ofrecele comunicarse con recepción.";
    case "verificacion_manual":
      return "No pude verificar la identidad para gestionar ese turno desde este número. Ofrecé que recepción revise el pedido, sin dar datos de la ficha.";
    case "otra_persona":
      return `Este número es de la ficha de ${result.patient.full_name ?? "otra persona"}, y ese DNI es de otro paciente que tiene otro celular. No cambies los datos de esta ficha ni le des datos de la otra. Si quiere un turno para esa persona, creá una tarea de tipo derivacion_humana con sus datos para que recepción lo agende.`;
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
    const current = await currentPatient(ctx);
    if (current?.dni !== dni) {
      const [taken] = await sql`
        select 1 from patients where clinic_id = ${ctx.clinicId} and dni = ${dni} ${current ? sql`and id <> ${current.id}` : sql``} limit 1`;
      if (!taken && current && isAnotherPerson(current, dni, input.nombre_completo)) {
        const member = await addHouseholdMember(ctx.clinicId, phone, {
          full_name: input.nombre_completo ?? null,
          dni,
          birth_date: birthDate ?? null,
          email: input.email ?? null,
          coverage: input.cobertura ?? null,
          coverage_plan: input.plan ?? null,
          member_number: input.numero_afiliado ?? null,
        });
        const other = current.full_name ?? "la otra persona";
        return {
          ok: true,
          mensaje: [
            `Registré a ${member.full_name} en una ficha aparte: comparte este celular con ${other}, que tiene la suya. Lo que sigas haciendo en esta conversación (turnos, pedidos) queda a nombre de ${member.full_name}; si después es para ${other}, usá buscar_paciente con su DNI y su nombre.`,
            ...notices,
          ].join(" "),
          paciente: { nombre: member.full_name, dni: member.dni, cobertura: member.coverage, plan: member.coverage_plan, numero_afiliado: member.member_number },
          ficha: await patientContextText(await getClinic(ctx.clinicId), member, phone),
        };
      }
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
    ...(joined ? { ficha: await patientContextText(await getClinic(ctx.clinicId), updated, phone) } : {}),
  };
}

// ---------------------------------------------------------------------------
// buscar_paciente
// ---------------------------------------------------------------------------
export async function findPatientByDni(
  ctx: ToolContext,
  input: { dni: string; fecha_nacimiento?: string; nombre_completo?: string; para_turno_existente?: boolean },
) {
  const phone = normalizePhone(ctx.patientPhone);
  if (!phone || phone === "desconocido") throw new ToolError("No tengo el teléfono del paciente para identificarlo.");
  if (input.para_turno_existente && /^\d{10,15}$/.test(phone) && await appointmentAccessEnabled(ctx.clinicId) && !appointmentAccessKey(ctx, true)) {
    throw new ToolError("No pude verificar esta conversación para gestionar el turno. Ofrecé que recepción revise el pedido.");
  }
  await expireAppointmentAccess(ctx);
  const dni = normalizeDni(input.dni);
  if (!dni) return { ok: true, encontrado: false, mensaje: "Ese DNI no parece válido. Pedíselo de nuevo, solo números." };
  const result = await identifyPatient(ctx.clinicId, phone, {
    dni,
    birthDate: parseDateKey(input.fecha_nacimiento),
    name: input.nombre_completo,
    appointmentConversationId: input.para_turno_existente ? ctx.conversationId : undefined,
  });
  if (result.estado !== "vinculado") {
    return { ok: true, encontrado: result.estado === "sin_ficha" ? false : null, mensaje: identificationNotice(result) };
  }
  if (result.soloTurnos) return {
    ok: true,
    encontrado: true,
    solo_turnos: true,
    mensaje: "Identidad verificada para gestionar turnos en esta conversación. Usá ver_turnos_paciente para encontrar el turno pedido. Confirmá el turno y el cambio antes de ejecutarlo. El permiso no incluye otros trámites ni actualiza los teléfonos de las fichas.",
  };
  await sql`update patients set last_contact_at = now() where id = ${result.patient.id}`;
  return {
    ok: true,
    encontrado: true,
    mensaje: result.familiar
      ? `Es paciente del consultorio y comparte este celular con la ficha anterior: esta conversación pasó a la ficha de ${result.patient.full_name ?? "esa persona"}. Lo que hagas ahora (turnos, pedidos) queda a su nombre. No le vuelvas a pedir los datos cargados y pedí solo los que faltan.`
      : "Es paciente del consultorio y quedó identificado: esta conversación ya usa su ficha. Llamalo por su nombre (sin volver a saludar), no le vuelvas a pedir los datos cargados y pedí solo los que faltan.",
    ficha: await patientContextText(await getClinic(ctx.clinicId), result.patient, phone),
  };
}

// ---------------------------------------------------------------------------
// consultar_disponibilidad
// ---------------------------------------------------------------------------
export async function checkAvailability(
  ctx: ToolContext,
  input: {
    tipo_turno_id?: string;
    turno_id?: string;
    segundo_tipo_turno_id?: string;
    profesional_id?: string;
    desde?: string;
    hasta?: string;
    hora_exacta?: string;
    franja?: "manana" | "tarde" | "cualquiera";
    cobertura?: string;
  },
) {
  const exactTime = parseClockTime(input.hora_exacta);
  if (input.hora_exacta !== undefined && !exactTime) throw new ToolError("La hora exacta debe ser válida, por ejemplo 15:00.");
  const clinic = await getClinic(ctx.clinicId);
  const catalog = await getCatalog(clinic.id);
  const links = catalog.links ?? [];
  const move = input.turno_id ? await loadReschedule(ctx, clinic, input.turno_id) : null;
  const type = catalog.appointmentTypes.find((t) => t.id === (move?.appt.appointment_type_id ?? input.tipo_turno_id));
  if (!type) throw new ToolError("No encontré ese tipo de turno. Usá un id del catálogo.");
  const next = move
    ? catalog.appointmentTypes.find((t) => t.id === move.follower?.appointment_type_id) ?? null
    : secondTypeOf(catalog.appointmentTypes, type, input.segundo_tipo_turno_id);
  // El equipo del consultorio puede dar también lo que da solo el consultorio.
  const asClinic = Boolean(ctx.staff);
  if (!move && !asClinic) {
    assertAgentCanBook(type);
    if (next) assertAgentCanBook(next);
  } else if (move?.follower && !next) {
    throw new ToolError("Una práctica de esta visita ya no está disponible. El cambio lo tiene que coordinar recepción.");
  }
  const visit = next ? [type, next] : [type];
  // Lo que pide una prestación antes (por ejemplo, la consulta de implantes antes de la colocación).
  const patient = move ? move.patient : await currentPatient(ctx);
  if (!move && !asClinic) await assertPrerequisites(catalog, patient, visit);

  const selectedPro = input.profesional_id || move?.appt.professional_id;
  const otherPro = move?.appt.second_professional_id;
  const capable = catalog.professionals.filter(
    (p) => visit.every((t) => professionalDoes(p, t, links)) && (!selectedPro || p.id === selectedPro) && p.id !== otherPro,
  );
  if (!capable.length) {
    throw new ToolError(
      next
        ? `No hay un profesional que haga ${type.name} y ${next.name} en la misma visita. Buscá cada una por separado y ofrecé dos turnos.`
        : "No hay profesionales que hagan ese tipo de turno.",
    );
  }

  // Cobertura: se ofrecen los profesionales que la atienden. Si nadie la atiende, los horarios
  // salen igual, como particular, con el aviso (nunca se frena la búsqueda por esto).
  let professionals = capable;
  let coverageNotice: string | undefined;
  const coverageNotes = new Map<string, string>();
  // El consultorio decide la cobertura: al equipo se le muestran todos los horarios.
  const wanted = move || asClinic ? null : input.cobertura?.trim() || patient?.coverage?.trim() || null;
  if (wanted) {
    const otherCoverage = input.cobertura?.trim() && patient?.coverage && coverageKey(input.cobertura) !== coverageKey(patient.coverage);
    const plan = otherCoverage ? null : patient?.coverage_plan;
    const checks = capable.map((p) => ({ p, check: checkCoverage(p, visit, wanted, plan, catalog.coverageRules) }));
    const fine = checks.filter((c) => c.check.ok);
    for (const { p, check } of fine) if (check.ok && check.notes.length) coverageNotes.set(p.id, check.notes.join(" "));
    if (fine.length) professionals = fine.map((c) => c.p);
    else {
      const reasons = [...new Set(checks.map((c) => (c.check.ok ? "" : c.check.reason)))].join(" ");
      // Nadie la atiende: se ofrece como particular con quienes atienden particular.
      const asParticular = isParticular(wanted) ? [] : capable.filter((p) => checkCoverage(p, visit, "Particular", null, catalog.coverageRules).ok);
      if (!asParticular.length) throw new ToolError(`${reasons} Nadie lo puede atender así: creá una tarea de derivacion_humana para que recepción lo coordine.`);
      professionals = asParticular;
      coverageNotice = `${reasons} Estos horarios son como particular: decíselo antes de ofrecerlos. Si lo acepta, reservá con cobertura «Particular»; si tiene otra cobertura, buscá de nuevo con esa.`;
    }
  }

  const now = new Date();
  const today = localDateKey(now, clinic.timezone);
  // Un turno de urgencia busca hoy y mañana, salvo que se pidan otras fechas.
  const urgent = type.is_urgent;
  const span = urgent && !input.desde && !input.hasta ? 1 : 14;
  let fromKey = parseDateKey(input.desde) ?? today;
  if (fromKey < today) fromKey = today;
  let toKey = parseDateKey(input.hasta) ?? addDaysKey(fromKey, span);
  if (toKey < fromKey) toKey = addDaysKey(fromKey, span);
  if (toKey > addDaysKey(fromKey, 60)) toKey = addDaysKey(fromKey, 60);

  const bookingDays = asClinic ? null : clinic.booking_weekdays;
  const dayNotice = bookingDaysText(bookingDays);
  let hasAllowedDay = false;
  for (let key = fromKey; key <= toKey; key = addDaysKey(key, 1)) {
    if (bookingDays == null || bookingDays.includes(weekdayOfKey(key))) { hasAllowedDay = true; break; }
  }
  if (!hasAllowedDay) return {
    ok: true, turnos: [], mensaje: `${dayNotice} No es una falta de disponibilidad: las fechas pedidas están reservadas al equipo.${move ? " El turno original sigue reservado." : ""}`,
    ...(exactTime && { hora_solicitada: { hora: exactTime, disponible: false } }),
  };

  const proIds = professionals.map((p) => p.id);
  const rangeStart = `${addDaysKey(fromKey, -1)}T00:00:00Z`;
  const rangeEnd = `${addDaysKey(toKey, 1)}T23:59:59Z`;
  const checkedPros = otherPro ? [...proIds, otherPro] : proIds;
  const movingIds = move ? [move.appt.id, ...(move.follower ? [move.follower.id] : [])] : [];
  // Con Smile Connect en modo real (diferido), solo se ofrece lo verificado allá en esta misma consulta.
  const verifySmile = await usesDeferredSmile(clinic.id);
  // Los días que Smile Connect no llegó a confirmar: cuentan como ocupados, y Sofi lo sabe.
  const unchecked: string[] = [];
  const workdays = [...new Set(catalog.schedules.filter((s) => checkedPros.includes(s.professional_id) && (bookingDays == null || bookingDays.includes(s.weekday))).map((s) => s.weekday))];
  const preserve = clinic.keep_duration_on_reschedule && !!move;
  const firstDuration = (move && keptDuration(move.appt, preserve)) || type.duration_min;
  const nextDuration = (move?.follower && keptDuration(move.follower, preserve)) || next?.duration_min || 0;
  const duration = firstDuration + nextDuration;
  const smileStarts = new Map<string, Set<number>>();
  const [busy, blocks, calendar, patientAppointments] = await Promise.all([
    busyOf(checkedPros, rangeStart, rangeEnd, movingIds),
    getScheduleBlocks(clinic.id, rangeStart, rangeEnd),
    // Lo ocupado en el Google Calendar de cada profesional y en Smile Connect (si la clínica los conectó).
    externalBusy(clinic.id, checkedPros, new Date(rangeStart), new Date(rangeEnd), { timeZone: clinic.timezone, ...(verifySmile && { verified: { from: fromKey, to: toKey, weekdays: workdays, unchecked }, durationMin: duration, starts: smileStarts }) }),
    move ? upcomingOf(move.patient.id) : [],
  ]);
  const blocked = expandBlocks(blocks, checkedPros);
  const otherSchedules = catalog.schedules.filter((s) => s.professional_id === otherPro);
  const otherBusy = [...busy, ...calendar, ...blocked].filter((b) => b.professional_id === otherPro);
  const ownBusy = patientAppointments.filter((a) => !movingIds.includes(a.id));

  // Los horarios que sirven para estas prestaciones. Las horas reservadas para urgencias solo
  // las usa un turno de urgencia, salvo que ya estén por empezar (se liberan cerca de la hora).
  const releaseUntil = clinic.urgent_release_hours ? now.getTime() + clinic.urgent_release_hours * 3600_000 : null;
  const usable = agentSchedules(
    catalog.schedules.filter((s) => proIds.includes(s.professional_id) && (bookingDays == null || bookingDays.includes(s.weekday))),
    visit.map((t) => t.id),
    { urgent: urgent || asClinic, released: releaseUntil !== null },
  );
  const releasedOk = (start: Date, block: ScheduleBlock) => urgent || asClinic || !block.urgent_only || (releaseUntil !== null && start.getTime() <= releaseUntil);
  // El primer turno del día no lo da Sofi si lo piden tarde (nadie lo vería antes de que llegue el paciente).
  const firstSlotOk = (start: Date, block: ScheduleBlock) =>
    asClinic ||
    !firstSlotOfDayBlocked({ start, durationMin: firstDuration, professionalId: block.professional_id, schedules: catalog.schedules, cutoffHour: clinic.first_slot_cutoff_hour, now, timeZone: clinic.timezone });
  const slotQuery: SlotQuery = {
    schedules: usable,
    busy: [...busy, ...calendar],
    blocked,
    // Dos prácticas en la misma visita: tienen que entrar las dos, una detrás de la otra.
    durationMin: duration,
    stepMin: move ? 15 : type.duration_min,
    accepts: (start, end, block) =>
      (!verifySmile || smileStarts.get(block.professional_id)?.has(start.getTime()) === true) &&
      releasedOk(start, block) &&
      firstSlotOk(start, block) &&
      (!move ||
        ((selectedPro !== move.appt.professional_id || start.getTime() !== Date.parse(move.appt.starts_at)) &&
          !ownBusy.some((a) => start < new Date(a.ends_at) && end > new Date(a.starts_at)) &&
          (!otherPro || isSlotFree(otherSchedules, otherBusy, start, duration, clinic.timezone).ok))),
    fromKey,
    toKey,
    timeZone: clinic.timezone,
    now,
    minLeadMinutes: urgent ? 30 : undefined,
    limit: 6,
    perDayPerProfessional: 2,
  };
  const matches = exactTime ? computeSlots({ ...slotQuery, startTime: exactTime }) : [];
  const slots = matches.length ? matches : computeSlots({ ...slotQuery, partOfDay: input.franja });
  const requestedTime = exactTime ? { hora_solicitada: { hora: exactTime, disponible: matches.length > 0 } } : {};
  const timeMessage = !exactTime ? "" : matches.length
    ? `Hay disponibilidad a las ${exactTime}. Ofrecé el horario solicitado. `
    : `La hora solicitada (${exactTime}) no está disponible en las fechas buscadas. Si hay opciones, ofrecelas como alternativas. `;

  const names = new Map(professionals.map((p) => [p.id, p.full_name]));
  // Días que la agenda del consultorio no confirmó a tiempo: no se dan por llenos ante el paciente.
  const notChecked = unchecked.length ? { dias_sin_revisar: unchecked } : {};
  const uncheckedText = unchecked.length === 1 ? `el ${unchecked[0]}` : `${unchecked.length} días entre el ${unchecked[0]} y el ${unchecked.at(-1)}`;
  if (!slots.length && !move) await recordOffer(ctx, input, "");
  if (!slots.length && unchecked.length) {
    return {
      ok: true,
      turnos: [],
      ...requestedTime,
      ...notChecked,
      ...(coverageNotice && { aviso_cobertura: coverageNotice }),
      mensaje: `La agenda del consultorio tardó en responder y no pude revisar ${uncheckedText} (están en dias_sin_revisar). En los demás días buscados no hay lugar. No le digas al paciente que no hay turnos en esas fechas: volvé a llamar a consultar_disponibilidad con desde=${unchecked[0]} y hasta=${unchecked.at(-1)} antes de responder.`,
    };
  }
  if (!slots.length) {
    return {
      ok: true,
      turnos: [],
      ...requestedTime,
      ...(coverageNotice && { aviso_cobertura: coverageNotice }),
      mensaje: timeMessage + (move
        ? `No hay horarios para mover esa visita entre ${fromKey} y ${toKey}. Ofrecé buscar otras fechas. El turno original sigue reservado.`
        : urgent && span === 1
          ? "No hay lugar de urgencia hoy ni mañana. Creá una tarea de tipo «urgencia» con prioridad «urgente» para que el equipo lo contacte hoy, y decile qué hacer mientras tanto según el protocolo de urgencias."
          : next
          ? `No hay horarios entre ${fromKey} y ${toKey} en los que entren ${type.name} y ${next.name} seguidas. Ofrecé buscar más adelante o dos turnos por separado.`
          : `No hay turnos libres entre ${fromKey} y ${toKey}. Buscá más adelante y reservale el primero que le sirva; la lista de espera es para adelantar ese turno.`),
    };
  }
  const turnos = slots.map((s) => ({
    profesional_id: s.professional_id,
    profesional: names.get(s.professional_id),
    inicio: s.starts_at,
    cuando: s.label,
    ...(next && { termina: clockTime(new Date(s.ends_at), clinic.timezone) }),
    ...(coverageNotes.has(s.professional_id) && { cobertura: coverageNotes.get(s.professional_id) }),
  }));
  // Lo que la prestación pide preguntar antes de reservar, y el aviso si nadie atiende su cobertura.
  const agendaNotice = unchecked.length
    ? { ...notChecked, aviso_agenda: `No pude revisar ${uncheckedText} (la agenda del consultorio tardó en responder). Si el paciente prefiere esas fechas, consultá de nuevo con ellas antes de decirle que no hay lugar.` }
    : {};
  const extras = {
    ...requestedTime,
    ...(coverageNotice && { aviso_cobertura: coverageNotice }),
    ...(visit.some((t) => t.ask_before) && { preguntar_antes: visit.map((t) => t.ask_before).filter(Boolean).join(" ") }),
    ...(urgent && !move && { urgencia: true }),
    ...agendaNotice,
  };
  if (move) {
    return {
      ok: true,
      ...requestedTime,
      ...agendaNotice,
      turno_id: move.appt.id,
      tipo_turno: move.appt.title || type.name,
      ...(next && { segunda_practica: move.follower?.title || next.name }),
      duracion_min: duration,
      turnos,
      mensaje: timeMessage + "Ofrecé los horarios devueltos para mover el turno existente. Tras la confirmación explícita, usá reprogramar_turno con este turno_id, el nuevo inicio y el profesional elegido. El turno original sigue reservado hasta que el cambio se confirma.",
    };
  }
  await recordOffer(ctx, input, next ? `${type.name} y ${next.name}` : type.name);
  if (next) {
    return {
      ok: true,
      ...extras,
      tipo_turno: `${type.name} y, a continuación, ${next.name}`,
      duracion_min: type.duration_min + next.duration_min,
      indicaciones: joinInstructions(type, next),
      turnos,
      mensaje: timeMessage + `Cada horario es una sola visita con el mismo profesional: ${type.name} (${type.duration_min} min) y enseguida ${next.name} (${next.duration_min} min), hasta la hora de 'termina'. Ofrecé hasta 3 opciones leyendo 'cuando'. Para reservar usá reservar_turno con los dos ids, y 'inicio' y 'profesional_id' tal cual.`,
    };
  }
  return {
    ok: true,
    ...extras,
    tipo_turno: type.name,
    duracion_min: type.duration_min,
    indicaciones: type.instructions,
    turnos,
    mensaje: timeMessage + (urgent
      ? "Es un turno de urgencia: ofrecé el primero o los dos primeros, leyendo el campo 'cuando'. Para reservar usá 'inicio' y 'profesional_id' tal cual."
      : "Ofrecé hasta 3 opciones al paciente, leyendo el campo 'cuando'. Para reservar usá 'inicio' y 'profesional_id' tal cual."),
  };
}

/**
 * Para una prestación que pide otra antes (la colocación de implantes, la consulta de implantes):
 * el paciente tiene que haber tenido esa otra o tenerla reservada, o pedirla en la misma visita.
 */
async function assertPrerequisites(catalog: Catalog, patient: Patient | null, visit: AppointmentType[]): Promise<void> {
  for (const t of visit) {
    if (!t.requires_type_id || visit.some((v) => v.id === t.requires_type_id)) continue;
    const required =
      catalog.appointmentTypes.find((x) => x.id === t.requires_type_id) ??
      (await sql<AppointmentType[]>`select * from appointment_types where id = ${t.requires_type_id}`)[0];
    if (!required) continue;
    const [had] = patient
      ? await sql<Array<{ yes: boolean }>>`
          select (exists (select 1 from appointments where patient_id = ${patient.id} and appointment_type_id = ${required.id}
              and status in ('confirmado', 'pendiente', 'atendido') and not (smile_deferred and status = 'pendiente'))
            or exists (select 1 from patient_visits where patient_id = ${patient.id} and appointment_type_id = ${required.id})) as yes`
      : [{ yes: false }];
    if (had?.yes) continue;
    const offer = required.active && !required.panel_only
      ? `Ofrecé primero ese turno (id=${required.id}).`
      : "Eso lo coordina el consultorio: creá una tarea de derivacion_humana.";
    throw new ToolError(`Para «${t.name}» el paciente tiene que haber tenido antes «${required.name}». ${offer} El tratamiento lo indica el profesional en esa consulta.`);
  }
}

/**
 * Guarda lo que el agente le ofreció al paciente en esta conversación, para volver a escribirle si no
 * contesta (followups.ts). Solo la última búsqueda de cada paciente queda abierta. Nunca corta la
 * búsqueda: si falla, el paciente igual recibe sus horarios.
 */
async function recordOffer(ctx: ToolContext, query: Record<string, unknown>, typeName: string): Promise<void> {
  if (!ctx.conversationId || ctx.channel === "panel" || !ctx.patientPhone) return;
  if (!typeName) {
    // Una búsqueda sin lugar reemplaza a la anterior: el seguimiento no puede ofrecer lo que el
    // agente descartó después (por ejemplo, otro profesional que el paciente no eligió).
    await sql`update agent_offers set closed_at = now() where clinic_id = ${ctx.clinicId} and patient_phone = ${ctx.patientPhone} and closed_at is null`
      .catch((e) => console.error("No se pudo cerrar el turno ofrecido", e instanceof Error ? e.message : e));
    return;
  }
  try {
    await sql.begin(async (tx) => {
      await tx`update agent_offers set closed_at = now() where clinic_id = ${ctx.clinicId} and patient_phone = ${ctx.patientPhone} and closed_at is null`;
      await tx`
        insert into agent_offers (clinic_id, conversation_id, patient_phone, query, type_name)
        values (${ctx.clinicId}, ${ctx.conversationId!}, ${ctx.patientPhone}, ${json(query)}, ${typeName})`;
    });
  } catch (e) {
    console.error("No se pudo guardar el turno ofrecido para el seguimiento", e instanceof Error ? e.message : e);
  }
}

/** La segunda práctica de una visita (control y limpieza, por ejemplo). */
function secondTypeOf<T extends Pick<AppointmentType, "id" | "name" | "panel_only">>(types: T[], first: T, id: string | undefined): T | null {
  if (!id) return null;
  const next = types.find((t) => t.id === id);
  if (!next) throw new ToolError("No encontré la segunda práctica. Usá un id del catálogo.");
  if (next.id === first.id) throw new ToolError("Las dos prácticas son la misma: buscá una sola.");
  return next;
}

const joinInstructions = (...types: Array<Pick<AppointmentType, "instructions">>) =>
  types.map((t) => t.instructions).filter(Boolean).join(" ") || null;

/** «13:40», en la hora de la clínica. */
const clockTime = (date: Date, timeZone: string) =>
  new Intl.DateTimeFormat("es-AR", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);

/** Un horario libre del día, para elegirlo en el panel. */
export type DaySlot = { hora: string; inicio: string };

/**
 * Panel → Agenda → turno a mano: todos los horarios libres de un día para un
 * profesional y una prestación. A diferencia del agente, no pide anticipación
 * mínima (la secretaria puede dar un turno para dentro de un rato).
 */
export async function freeSlotsOnDay(
  clinicId: string,
  input: { tipo_turno_id: string; profesional_id: string; fecha: string; ignorar_turno_id?: string; segundo_profesional_id?: string },
): Promise<{ turnos: DaySlot[]; horario: string | null; motivo: string | null }> {
  const clinic = await getClinic(clinicId);
  const catalog = await getCatalog(clinic.id);
  const type = catalog.appointmentTypes.find((t) => t.id === input.tipo_turno_id);
  const pro = catalog.professionals.find((p) => p.id === input.profesional_id);
  if (!type || !pro || !professionalDoes(pro, type, catalog.links)) return { turnos: [], horario: null, motivo: "Elegí la prestación y quién la atiende." };
  const dayKey = parseDateKey(input.fecha);
  if (!dayKey) return { turnos: [], horario: null, motivo: "Elegí una fecha." };
  if (dayKey < localDateKey(new Date(), clinic.timezone)) return { turnos: [], horario: null, motivo: "Ese día ya pasó." };

  // El consultorio ve también las horas reservadas para urgencias: decide él.
  const schedules = schedulesForTypes(catalog.schedules, [type.id]).filter((s) => s.professional_id === pro.id && s.weekday === weekdayOfKey(dayKey));
  const horario = schedules.length
    ? [...schedules]
        .sort((a, b) => a.start_time.localeCompare(b.start_time))
        .map((s) => `${s.start_time.slice(0, 5)} a ${s.end_time.slice(0, 5)}`)
        .join(" y ")
    : null;
  if (!horario) return { turnos: [], horario, motivo: `${pro.full_name} no atiende ese día.` };

  const rangeStart = `${addDaysKey(dayKey, -1)}T00:00:00Z`;
  const rangeEnd = `${addDaysKey(dayKey, 1)}T23:59:59Z`;
  // Con un segundo profesional, solo sirven los horarios en que los dos están libres.
  const second = catalog.professionals.find((p) => p.id === input.segundo_profesional_id && p.id !== pro.id);
  const both = second ? [pro.id, second.id] : [pro.id];
  const [busy, blocks, calendar] = await Promise.all([
    busyOf(both, rangeStart, rangeEnd, isUuid(input.ignorar_turno_id) ? input.ignorar_turno_id : undefined),
    getScheduleBlocks(clinic.id, rangeStart, rangeEnd),
    externalBusy(clinic.id, both, new Date(rangeStart), new Date(rangeEnd), { timeZone: clinic.timezone }),
  ]);
  const asPro = (b: BusyInterval) => ({ ...b, professional_id: pro.id });
  const blocked = expandBlocks(blocks, both).map(asPro);
  const query = {
    schedules,
    busy: [...busy, ...calendar].map(asPro),
    durationMin: type.duration_min,
    fromKey: dayKey,
    toKey: dayKey,
    timeZone: clinic.timezone,
    now: new Date(),
    minLeadMinutes: 0,
    limit: 500,
    perDayPerProfessional: 500,
  };
  // Y dentro del horario de los dos.
  const secondSchedules = second ? catalog.schedules.filter((s) => s.professional_id === second.id) : [];
  const slots = computeSlots({ ...query, blocked }).filter(
    (s) => !second || isSlotFree(secondSchedules, [], new Date(s.starts_at), type.duration_min, clinic.timezone).ok,
  );
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
  /** Los turnos que se están moviendo: no cuentan como ocupados. */
  ignoreAppointmentId?: string | string[];
  /** Desde el panel: darlo aunque sea fuera de horario, en un día bloqueado u ocupado en Google. */
  force?: boolean;
  /** Desde el panel: otro profesional que atiende el mismo turno (también tiene que estar libre). */
  secondProfessionalId?: string | null;
  /** Al mover un turno con duración propia (por ejemplo, traído de Smile Connect), conservarla. */
  durationMin?: number;
  /** Lo da o lo mueve el consultorio: puede usar las horas reservadas para urgencias. */
  byPanel?: boolean;
  /** El alta pendiente se verifica contra Smile Connect antes de escribirla, fuera del pedido. */
  deferSmile?: boolean;
};

const AGAIN = " Consultá la disponibilidad de nuevo y ofrecé otra opción.";
const FIRST_SLOT = "Ese horario es el primero del día y con tan poco aviso lo asigna solo el consultorio: no se lo ofrezcas al paciente.";

/** El agente no da, no ofrece ni mueve las prestaciones que la clínica se reserva (por ejemplo, una endodoncia que evalúa el profesional). */
function assertAgentCanBook(type: Pick<AppointmentType, "name" | "panel_only">) {
  if (type.panel_only) {
    throw new ToolError(
      `«${type.name}» la da solo el consultorio: no la ofrezcas, no la reserves ni la muevas. Seguí las instrucciones de la clínica para este caso (por ejemplo, ofrecé la consulta previa que corresponda).`,
    );
  }
}

async function assertBookable(clinic: Clinic, professionalId: string, typeId: string, startsAt: Date, opts: BookOptions = {}) {
  const catalog = await getCatalog(clinic.id);
  const type = catalog.appointmentTypes.find((t) => t.id === typeId);
  if (!type) throw new ToolError("Tipo de turno inválido.");
  const pro = catalog.professionals.find((p) => p.id === professionalId);
  if (!pro) throw new ToolError("Profesional inválido.");
  if (!professionalDoes(pro, type, catalog.links)) throw new ToolError(`${pro.full_name} no hace ${type.name}.`);
  if (Number.isNaN(startsAt.getTime())) throw new ToolError("La fecha de inicio no es válida. Usá el campo 'inicio' de consultar_disponibilidad.");
  if (startsAt.getTime() < Date.now()) throw new ToolError("Ese horario ya pasó.");
  if (!opts.byPanel && !agentBookingDayAllowed(clinic.booking_weekdays, startsAt, clinic.timezone)) {
    throw new ToolError(`${bookingDaysText(clinic.booking_weekdays)} No reserves ni muevas el turno a ese día. El turno original, si existe, se conserva.`);
  }

  let second = null as (typeof catalog.professionals)[number] | null;
  if (opts.secondProfessionalId) {
    second = catalog.professionals.find((p) => p.id === opts.secondProfessionalId) ?? null;
    if (!second) throw new ToolError("No encontré al otro profesional del turno.");
    if (second.id === pro.id) throw new ToolError("El otro profesional tiene que ser distinto del que atiende el turno.");
  }

  const durationMin = opts.durationMin ?? type.duration_min;
  const endsAt = new Date(startsAt.getTime() + durationMin * 60_000);
  const [busy, blocks] = await Promise.all([
    busyOf(second ? [pro.id, second.id] : [pro.id], startsAt, endsAt, opts.ignoreAppointmentId),
    getScheduleBlocks(clinic.id, startsAt, endsAt),
  ]);
  // Otro turno de Turnia en ese horario: ni el agente ni el turno normal se superponen.
  if (busy.some((b) => b.professional_id === pro.id)) throw new ToolError(`Ese horario ya está ocupado.${AGAIN}`);
  if (second && busy.length) throw new ToolError(`${second.full_name} ya tiene un turno a esa hora.`);
  if (!opts.force) {
    // Horarios de esta prestación. Las horas de urgencias, solo para urgencias, para el consultorio
    // o si ya se liberaron (cerca de la hora).
    const released = clinic.urgent_release_hours && startsAt.getTime() <= Date.now() + clinic.urgent_release_hours * 3600_000;
    const own = (id: string) => catalog.schedules.filter((s) => s.professional_id === id);
    for (const who of second ? [pro, second] : [pro]) {
      const check = isSlotFree(
        who === pro
          ? agentSchedules(own(pro.id), [type.id], { urgent: type.is_urgent || !!opts.byPanel, released: !!released })
          : own(who.id),
        [],
        startsAt,
        durationMin,
        clinic.timezone,
        expandBlocks(blocks, [who.id]),
      );
      if (!check.ok) throw new ToolError(`${who === pro ? "" : `${who.full_name}: `}${check.reason}${who === pro ? AGAIN : ""}`, true);
    }
    // El primer turno del día pedido tarde: lo da solo el consultorio.
    if (
      !opts.byPanel &&
      firstSlotOfDayBlocked({ start: startsAt, durationMin, professionalId: pro.id, schedules: catalog.schedules, cutoffHour: clinic.first_slot_cutoff_hour, now: new Date(), timeZone: clinic.timezone })
    ) {
      throw new ToolError(`${FIRST_SLOT}${AGAIN}`);
    }
    // Al reservar se consulta Google en el momento, para ese horario exacto: lo que se
    // anotó recién en el calendario del profesional también cuenta.
    const calendar = await externalBusy(clinic.id, second ? [pro.id, second.id] : [pro.id], startsAt, endsAt, { fresh: true, deferSmile: opts.deferSmile, timeZone: clinic.timezone });
    const overlapping = calendar.filter((b) => new Date(b.starts_at) < endsAt && new Date(b.ends_at) > startsAt);
    // Al paciente no se le cuenta qué tiene el profesional en su calendario; al consultorio, sí.
    if (overlapping.length) {
      const hit = overlapping.find((b) => b.professional_id === pro.id) ?? overlapping[0];
      const who = hit.professional_id === pro.id ? pro : second!;
      const where = hit.source === "smile" ? `la agenda de Smile Connect de ${who.full_name} (turno, bloqueo o fuera de horario)` : `el Google Calendar de ${who.full_name}`;
      throw new ToolError(`Ese horario ya está ocupado.${AGAIN}`, true, `Ese horario está ocupado en ${where}.`);
    }
  }
  return { type, pro, second, endsAt };
}

/**
 * ¿El profesional atiende esa cobertura para estas prestaciones? Devuelve el nombre como lo cargó la
 * clínica y lo que hay que avisarle al paciente. El consultorio (panel) solo mira la lista del
 * profesional; Sofi, también la matriz de coberturas.
 */
function coverageFor(
  catalog: Catalog,
  pro: Catalog["professionals"][number],
  types: AppointmentType[],
  coverage: string | null | undefined,
  plan: string | null | undefined,
  byPanel: boolean,
): { coverage: string | null; notes: string[] } {
  const check = checkCoverage(pro, types, coverage, plan, byPanel ? [] : catalog.coverageRules);
  if (!check.ok) throw new ToolError(check.reason);
  return { coverage: check.coverage, notes: check.notes };
}

/** El plan del paciente solo vale para la cobertura de su ficha. */
const planFor = (patient: Patient, coverage: string | null | undefined) =>
  coverage && patient.coverage && coverageKey(coverage) === coverageKey(patient.coverage) ? patient.coverage_plan : null;

type PatientAppointment = Pick<Appointment, "id" | "starts_at" | "ends_at" | "professional_id" | "appointment_type_id" | "status" | "external_id" | "smile_sync" | "smile_deferred" | "smile_reply_phone">
  & { professional: string; type_name: string };

/** Los turnos activos que todavía no terminaron de un paciente. */
async function upcomingOf(patientId: string): Promise<PatientAppointment[]> {
  return sql<PatientAppointment[]>`
    select a.id, a.starts_at, a.ends_at, a.professional_id, a.appointment_type_id, a.status, a.external_id, a.smile_sync, a.smile_deferred, a.smile_reply_phone,
           pr.full_name || coalesce(' y ' || p2.full_name, '') as professional, coalesce(a.title, t.name) as type_name
    from appointments a
    join professionals pr on pr.id = a.professional_id
    left join professionals p2 on p2.id = a.second_professional_id
    join appointment_types t on t.id = a.appointment_type_id
    where a.patient_id = ${patientId} and a.status = any(${ACTIVE}::text[]) and a.ends_at > now()
    order by a.starts_at`;
}

/** La constraint appointments_no_overlap rechazó el turno: alguien lo tomó recién. */
const isOverlapError = (error: unknown) => pgErrorCode(error) === "23P01";


type NewAppointment = Pick<
  Appointment,
  "clinic_id" | "patient_id" | "professional_id" | "appointment_type_id" | "starts_at" | "ends_at" | "status" | "source" | "coverage" | "notes"
> & Partial<Pick<Appointment, "second_professional_id" | "title" | "smile_deferred" | "smile_reply_phone">>;

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
  // Con los locks por profesional ya tomados, verificamos que ni el principal ni el
  // segundo profesional queden en dos turnos activos superpuestos.
  const ids = [row.professional_id, row.second_professional_id].filter((id): id is string => Boolean(id));
  const [taken] = await tx`
    select 1 from appointments
    where status = any(${ACTIVE}::text[]) and starts_at < ${row.ends_at} and ends_at > ${row.starts_at}
      and (professional_id = any(${ids}::uuid[]) or second_professional_id = any(${ids}::uuid[]))
    limit 1`;
  if (taken) throw new ToolError("Ese horario se acaba de ocupar. Consultá la disponibilidad de nuevo.");
  const [appt] = await tx<Appointment[]>`insert into appointments ${tx(row)} returning *`;
  return appt;
}

type BookInput = {
  tipo_turno_id: string;
  /** Otra práctica en la misma visita, a continuación y con el mismo profesional. */
  segundo_tipo_turno_id?: string;
  profesional_id: string;
  inicio: string;
  nombre_completo?: string;
  cobertura?: string;
  notas?: string;
  /** Nombre propio del turno: pidió una «Consulta de implantes» y se reserva la prestación de consulta. */
  titulo?: string;
};

/** «consulta de implantes» → «Consulta de implantes»; vacío o igual a la prestación, sin nombre propio. */
export function appointmentTitle(raw: string | undefined, typeName: string): string | null {
  const title = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!title || title.toLowerCase() === typeName.trim().toLowerCase()) return null;
  return title.charAt(0).toUpperCase() + title.slice(1);
}

/**
 * Por chat (WhatsApp o web), Sofi espera unos segundos a Smile Connect para contestar en el mismo
 * mensaje si el turno quedó, en vez de «le avisamos cuando se confirme». Por teléfono se comprueba
 * con consultar_estado_turno; en el panel, sigue diferido. Devuelve null si no hay resultado a tiempo.
 */
async function settleInChat(clinicId: string, appointmentId: string, ctx: ToolContext): Promise<boolean> {
  const wait = env.smileChatWaitMs();
  const source = sourceFromChannel(ctx.channel, ctx.patientPhone);
  if (!wait || source === "telefono" || source === "panel") {
    processSmileBookingLater(clinicId, appointmentId);
    return false;
  }
  return settleSmileBooking(clinicId, appointmentId, wait);
}

/** El resultado que Sofi contesta en el chat cuando Smile Connect respondió a tiempo. */
type ChatSettled = {
  ok: boolean;
  turno_id: string;
  segundo_turno_id?: undefined;
  mensaje: string;
  direccion?: string | null;
  indicaciones?: string;
  ocupado?: boolean;
  pendiente_recepcion?: boolean;
  ficha_de_salud?: NonNullable<Awaited<ReturnType<typeof healthFormOffer>>>;
};

/** Lo que quedó de un turno nuevo después de escribirlo en Smile Connect, para contestarlo en el chat. */
async function settledBooking(clinic: Clinic, appointmentId: string, ctx: ToolContext): Promise<ChatSettled | null> {
  const [row] = await sql<Array<Appointment & { professional: string; type_name: string; instructions: string | null }>>`
    select a.*, p.full_name as professional, coalesce(a.title, t.name) as type_name, t.instructions
    from appointments a join professionals p on p.id = a.professional_id join appointment_types t on t.id = a.appointment_type_id
    where a.id = ${appointmentId}`;
  if (!row) return null;
  const when = humanSlot(new Date(row.starts_at), clinic.timezone);
  const confirmed = row.status === "confirmado" && row.smile_sync === "ok";
  const occupied = row.status === "cancelado" && !row.smile_sync;
  const review = row.smile_sync === "revisar";
  if (!confirmed && !occupied && !review) return null;
  const alreadySent = await noticesToldInChat([row.id]);
  if (occupied) return { ok: false, ocupado: true, turno_id: row.id,
    mensaje: `El horario del ${when} se ocupó recién en la agenda: no quedó reservado. Decíselo en una línea y ofrecé otros horarios (consultá de nuevo).` };
  if (review) return { ok: false, pendiente_recepcion: true, turno_id: row.id,
    mensaje: "La agenda no lo pudo confirmar y el pedido quedó en recepción, que lo revisa y le escribe. Decile que todavía no tiene el turno confirmado. No crees otra tarea." };
  if (alreadySent) return { ok: true, turno_id: row.id,
    mensaje: `Turno confirmado: ${row.type_name} con ${row.professional} el ${when}. Ya le llegó la confirmación por WhatsApp: decile solo que quedó confirmado.` };
  // Como en una reserva confirmada al momento: al paciente nuevo se le ofrece la ficha de salud.
  const [patient] = ctx.staff ? [] : await sql<Patient[]>`select * from patients where id = ${row.patient_id}`;
  const healthForm = patient
    ? await healthFormOffer(clinic, patient, sourceFromChannel(ctx.channel, ctx.patientPhone), ctx.conversationId).catch((e) => {
        console.error("Ficha de salud: no se pudo preparar la oferta", e);
        return null;
      })
    : null;
  return {
    ok: true,
    turno_id: row.id,
    mensaje: `Turno confirmado: ${row.type_name} con ${row.professional} el ${when}.`,
    direccion: clinic.address,
    indicaciones: row.instructions ?? undefined,
    ...(healthForm && { ficha_de_salud: healthForm }),
  };
}

async function pendingSmileResult(clinic: Clinic, appointment: Pick<Appointment, "id" | "smile_reply_phone" | "smile_sync">, ctx: ToolContext) {
  const review = appointment.smile_sync === "revisar";
  if (!review && await settleInChat(clinic.id, appointment.id, ctx)) {
    const settled = await settledBooking(clinic, appointment.id, ctx);
    if (settled) return settled;
  }
  return {
    ok: false,
    pendiente_confirmacion: !review,
    pendiente_recepcion: review,
    turno_id: appointment.id,
    segundo_turno_id: undefined,
    mensaje: review
      ? "El pedido sigue pendiente y ya está en recepción. No crees otra tarea ni confirmes el turno."
      : sourceFromChannel(ctx.channel, ctx.patientPhone) === "telefono"
        ? "Pedido guardado. Antes de despedirte, llamá una vez a consultar_estado_turno con este turno_id para comprobar si quedó confirmado. Todavía no lo confirmes ni prometas un aviso por la llamada."
      : appointment.smile_reply_phone
        ? "Pedido recibido. Decile al paciente, en una línea, que le avisás por acá apenas quede confirmado. El turno sigue pendiente. No crees una tarea ni repitas la reserva."
        : "Pedido recibido. El turno sigue pendiente de verificación en la agenda. No lo confirmes todavía ni repitas la reserva.",
  };
}

export async function bookAppointment(ctx: ToolContext, input: BookInput, opts: Pick<BookOptions, "force" | "secondProfessionalId"> = {}) {
  const clinic = await getClinic(ctx.clinicId);
  const liveSmile = await usesLiveSmile(clinic.id);
  // Confirmación diferida: el pedido queda guardado y se confirma (por WhatsApp) después de verificarlo
  // en Smile Connect, fuera de la reserva. Así una demora de Smile Connect no deja una transacción abierta.
  const deferSmile = liveSmile && await usesDeferredSmile(clinic.id);
  // El panel y el equipo del consultorio por WhatsApp reservan como el consultorio.
  const byPanel = ctx.channel === "panel" || Boolean(ctx.staff);
  const source = sourceFromChannel(ctx.channel, ctx.patientPhone);
  const replyPhone = smileReplyPhone(ctx, source);
  const patient = await ensurePatient(ctx, input.nombre_completo);
  if (!patient.full_name) throw new ToolError("Antes de reservar necesito el nombre y apellido del paciente (registrar_paciente).");

  const startsAt = new Date(input.inicio);
  const mine = await upcomingOf(patient.id);
  const bookedAt = (typeId: string, at: Date) =>
    mine.find((a) => a.professional_id === input.profesional_id && a.appointment_type_id === typeId && new Date(a.starts_at).getTime() === at.getTime());
  // El mismo turno ya reservado (el agente reintentó la herramienta, o un doble clic): no es un error.
  // Si ya tiene la primera práctica y pide la segunda, se suma la segunda a continuación.
  const same = bookedAt(input.tipo_turno_id, startsAt);
  const sameNext = same && input.segundo_tipo_turno_id ? bookedAt(input.segundo_tipo_turno_id, new Date(same.ends_at)) : undefined;
  if (same?.smile_deferred && same.status === "pendiente") return pendingSmileResult(clinic, same, ctx);
  for (const existing of [same, sameNext]) {
    if (existing && (smileBookingPending(existing) || (liveSmile && !existing.external_id?.startsWith("sc:")))) {
      throw new SmileHandoff("Ese turno figura para revisión de recepción. Todavía no puedo confirmar la reserva.", `Comprobar en Smile Connect el turno de Turnia ${existing.id}.`);
    }
  }
  if (liveSmile && (((deferSmile || !same) && input.segundo_tipo_turno_id) || opts.secondProfessionalId)) {
    throw new SmileHandoff("El equipo del consultorio coordina esta visita combinada. Todavía no quedó reservada.", "Coordinar la visita combinada solicitada.");
  }
  if (same && (!input.segundo_tipo_turno_id || sameNext)) {
    return {
      ok: true,
      turno_id: same.id,
      ...(sameNext && { segundo_turno_id: sameNext.id }),
      mensaje: `Ese turno ya estaba reservado: ${same.type_name}${sameNext ? ` y, a continuación, ${sameNext.type_name}` : ""} con ${same.professional} el ${humanSlot(startsAt, clinic.timezone)}.`,
      direccion: clinic.address,
    };
  }

  type Part = Awaited<ReturnType<typeof assertBookable>> & { startsAt: Date };
  const parts: Part[] = [];
  if (!same) parts.push({ ...(await assertBookable(clinic, input.profesional_id, input.tipo_turno_id, startsAt, { ...opts, byPanel, deferSmile })), startsAt });
  if (input.segundo_tipo_turno_id) {
    const { appointmentTypes } = await getCatalog(clinic.id);
    const first = appointmentTypes.find((t) => t.id === input.tipo_turno_id);
    if (!first) throw new ToolError("Tipo de turno inválido.");
    const next = secondTypeOf(appointmentTypes, first, input.segundo_tipo_turno_id)!;
    const nextStart = same ? new Date(same.ends_at) : parts[0].endsAt;
    try {
      parts.push({ ...(await assertBookable(clinic, input.profesional_id, next.id, nextStart, { force: opts.force, byPanel })), startsAt: nextStart });
    } catch (e) {
      if (!(e instanceof ToolError)) throw e;
      const reason = e.message.replace(AGAIN, "");
      throw new ToolError(
        same
          ? `Después de su turno de ${first.name} no queda lugar para ${next.name} (${reason}) Ofrecé buscarla en otro horario, con consultar_disponibilidad solo para ${next.name}.`
          : `A continuación de ${first.name} no entra ${next.name} (${reason}) Consultá la disponibilidad con las dos prácticas (segundo_tipo_turno_id) y ofrecé otra opción.`,
        e.forzable,
        e.panelMessage,
      );
    }
  }
  const catalog = await getCatalog(clinic.id);
  const visit = [input.tipo_turno_id, input.segundo_tipo_turno_id]
    .map((id) => catalog.appointmentTypes.find((t) => t.id === id))
    .filter((t): t is AppointmentType => Boolean(t));
  if (!byPanel) {
    for (const p of parts) assertAgentCanBook(p.type);
    await assertPrerequisites(catalog, patient, visit);
  }
  // Una persona no puede estar en dos turnos a la vez.
  for (const p of parts) {
    const clash = mine.find((a) => a.id !== same?.id && new Date(a.starts_at) < p.endsAt && new Date(a.ends_at) > p.startsAt);
    if (clash) {
      throw new ToolError(
        `El paciente ya tiene un turno a esa hora: ${clash.type_name} con ${clash.professional} el ${humanSlot(new Date(clash.starts_at), clinic.timezone)}. Si lo quiere cambiar, usá reprogramar_turno.`,
      );
    }
  }
  const { pro, second } = parts[0];
  const wantedCoverage = input.cobertura || patient.coverage;
  const { coverage, notes: coverageNotes } = coverageFor(catalog, pro, visit, wantedCoverage, planFor(patient, wantedCoverage), byPanel);
  // El nombre propio es de la primera práctica (la que se está reservando ahora).
  const title = same ? null : appointmentTitle(input.titulo, parts[0].type.name);
  const nameOf = (p: Part, i: number) => (i === 0 && title) || p.type.name;

  let created: Appointment[];
  let smileProblem: string | null = null;
  try {
    ({ rows: created, problem: smileProblem } = await sql.begin(async (tx) => {
      // Mismo orden que la importación de Smile Connect: clínica, luego profesionales.
      if (writesEnabledOnServer()) {
        await tx`select pg_advisory_xact_lock(hashtextextended(${`smile-connect:${clinic.id}`}, 0))`;
        if (liveSmile !== await usesLiveSmile(clinic.id, tx)) {
          throw new SmileHandoff("La configuración de la agenda cambió mientras reservaba. Recepción tiene que revisar el pedido.", `Verificar el pedido para el ${humanSlot(startsAt, clinic.timezone)}.`);
        }
      }
      await lockProfessionals(tx, second ? [pro.id, second.id] : [pro.id]);
      if (deferSmile) {
        const [existing] = await tx<Appointment[]>`
          select * from appointments where clinic_id = ${clinic.id} and patient_id = ${patient.id}
            and professional_id = ${pro.id} and appointment_type_id = ${input.tipo_turno_id}
            and starts_at = ${startsAt.toISOString()} and status = any(${ACTIVE}::text[]) and smile_deferred`;
        if (existing) return { rows: [existing], problem: null };
      }
      const rows: Appointment[] = [];
      for (const [i, p] of parts.entries()) {
        rows.push(
          await insertAppointment(tx, {
            clinic_id: clinic.id,
            patient_id: patient.id,
            professional_id: p.pro.id,
            second_professional_id: p.second?.id ?? null,
            appointment_type_id: p.type.id,
            starts_at: p.startsAt.toISOString(),
            ends_at: p.endsAt.toISOString(),
            status: liveSmile ? "pendiente" : "confirmado",
            source,
            coverage,
            notes: i === 0 ? (input.notas ?? null) : null,
            ...(i === 0 && title && { title }),
            ...(deferSmile && { smile_deferred: true, smile_reply_phone: replyPhone }),
          }),
        );
      }
      if (!liveSmile || deferSmile) return { rows, problem: null };
      const problem = await confirmNewSmileAppointment(tx, clinic.id, rows[0].id);
      if (problem) return { rows, problem };
      const confirmed = await tx<Appointment[]>`select * from appointments where id = ${rows[0].id}`;
      return { rows: confirmed, problem: null };
    }));
  } catch (e) {
    if (isOverlapError(e)) throw new ToolError("Ese horario se acaba de ocupar. Consultá la disponibilidad de nuevo.");
    throw e;
  }
  if (deferSmile) {
    const [appointment] = created;
    if (appointment.status === "pendiente") return pendingSmileResult(clinic, appointment, ctx);
    return { ok: true, turno_id: appointment.id, segundo_turno_id: undefined, mensaje: "Ese turno ya estaba confirmado.", direccion: clinic.address };
  }
  if (smileProblem !== null) {
    throw new SmileHandoff(
      "No pude confirmar el turno en la agenda del consultorio. Recepción tiene que revisar el pedido antes de confirmar.",
      `Revisar el turno de Turnia ${created[0].id}, ${humanSlot(parts[0].startsAt, clinic.timezone)} con ${pro.full_name}. ${smileProblem}`,
    );
  }

  for (const [i, p] of parts.entries()) {
    // Si el paciente estaba en lista de espera para esto, la damos por resuelta.
    await sql`
      update waitlist set status = 'resuelta'
      where patient_id = ${patient.id} and appointment_type_id = ${p.type.id} and appointment_id is null and status in ('activa', 'ofrecida')`;
    await notifyN8n("turno.reservado", { clinic_id: clinic.id, appointment: created[i], patient, professional: p.pro.full_name, type: nameOf(p, i) });
  }

  const names = `${pro.full_name}${second ? ` y ${second.full_name}` : ""}`;
  const last = parts[parts.length - 1];
  const until = clockTime(last.endsAt, clinic.timezone);
  const mensaje = same
    ? `Listo: se sumó ${last.type.name} a continuación de su turno de ${same.type_name} del ${humanSlot(startsAt, clinic.timezone)} con ${names}. La visita termina a las ${until}.`
    : parts.length > 1
      ? `Turno confirmado, una sola visita con ${names}: ${nameOf(parts[0], 0)} el ${humanSlot(startsAt, clinic.timezone)} y, a continuación, ${last.type.name}. Termina a las ${until}.`
      : `Turno confirmado: ${nameOf(parts[0], 0)} con ${names} el ${humanSlot(startsAt, clinic.timezone)}.`;
  // ¿Ya tenía otro turno de lo mismo? Puede ser a propósito (dos sesiones), o que quería cambiarlo.
  const other = !same && mine.find((a) => a.appointment_type_id === parts[0].type.id);
  // Paciente nuevo (o ficha vencida): ofrecerle completar la ficha de salud por chat.
  // El turno ya quedó reservado: si esto falla, se confirma igual.
  // Lo reserva el consultorio (panel o equipo por WhatsApp): la ficha se la ofrece Sofi al paciente, no a quien reserva.
  const healthForm =
    byPanel
      ? null
      : await healthFormOffer(clinic, patient, sourceFromChannel(ctx.channel, ctx.patientPhone), ctx.conversationId).catch((e) => {
          console.error("Ficha de salud: no se pudo preparar la oferta", e);
          return null;
        });
  return {
    ok: true,
    turno_id: same?.id ?? created[0].id,
    ...((same || parts.length > 1) && { segundo_turno_id: created[created.length - 1].id }),
    mensaje,
    direccion: clinic.address,
    indicaciones: joinInstructions(...parts.map((p) => p.type)),
    ...(coverageNotes.length && { cobertura: coverageNotes.join(" ") }),
    ...(other && {
      aviso: `Ya tenía otro turno de ${other.type_name} el ${humanSlot(new Date(other.starts_at), clinic.timezone)}. Preguntale si quiere mantener los dos o cancelar el otro.`,
    }),
    ...(healthForm && { ficha_de_salud: healthForm }),
  };
}

// ---------------------------------------------------------------------------
// ver_turnos_paciente
// ---------------------------------------------------------------------------
export async function listPatientAppointments(ctx: ToolContext) {
  const clinic = await getClinic(ctx.clinicId);
  const patient = await appointmentPatient(ctx);
  if (!patient) return { ok: true, turnos: [], mensaje: "El paciente no tiene turnos registrados." };
  const rows = await sql<
    Array<{ id: string; starts_at: string; ends_at: string; status: string; professional_id: string; appointment_type_id: string; professional: string; type_name: string }>
  >`
    select a.id, a.starts_at, a.ends_at, a.status, a.professional_id, a.appointment_type_id,
           pr.full_name || coalesce(' y ' || p2.full_name, '') as professional, coalesce(a.title, t.name) as type_name
    from appointments a
    join professionals pr on pr.id = a.professional_id
    left join professionals p2 on p2.id = a.second_professional_id
    join appointment_types t on t.id = a.appointment_type_id
    where a.patient_id = ${patient.id} and a.status = any(${ACTIVE}::text[]) and a.starts_at >= now()
    order by a.starts_at`;
  return {
    ok: true,
    turnos: rows.map((r) => ({
      turno_id: r.id,
      cuando: humanSlot(new Date(r.starts_at), clinic.timezone),
      inicio: r.starts_at,
      fin: r.ends_at,
      tipo_turno: r.type_name,
      tipo_turno_id: r.appointment_type_id,
      profesional: r.professional,
      profesional_id: r.professional_id,
      estado: r.status,
    })),
  };
}

function smileBookingPending(appt: Pick<Appointment, "status" | "smile_sync" | "smile_deferred">): boolean {
  return appt.status === "pendiente" && (appt.smile_sync === "revisar" || !!appt.smile_deferred);
}

function requireConfirmedSmileBooking(appt: Appointment) {
  if (smileBookingPending(appt)) {
    if (appt.smile_deferred) throw new ToolError("El pedido sigue pendiente de verificación en la agenda.");
    throw new SmileHandoff("Ese pedido sigue pendiente de confirmación por el consultorio.", `Revisar el turno de Turnia ${appt.id} antes de gestionarlo.`);
  }
}

async function getOwnAppointment(ctx: ToolContext, appointmentId: string) {
  // El equipo del consultorio puede tocar cualquier turno de la clínica.
  if (ctx.staff) {
    const result = await getClinicAppointment(ctx.clinicId, appointmentId);
    requireConfirmedSmileBooking(result.appt);
    return result;
  }
  const patient = await appointmentPatient(ctx);
  if (!patient) throw new ToolError("No encontré al paciente.");
  const [appt] = isUuid(appointmentId)
    ? await sql<Appointment[]>`select * from appointments where id = ${appointmentId} and patient_id = ${patient.id}`
    : [];
  if (!appt) throw new ToolError("No encontré ese turno para este paciente. Usá ver_turnos_paciente.");
  if (!ACTIVE.includes(appt.status)) throw new ToolError(`Ese turno ya está ${appt.status}.`);
  requireConfirmedSmileBooking(appt);
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
/** Lo que quedó de un pedido de mover o cancelar después de escribirlo en Smile Connect, para contestarlo en el chat. */
async function settledManagement(appt: Appointment, request: SmileManagement): Promise<ChatSettled | null> {
  const clinic = await getClinic(appt.clinic_id);
  const [row] = await sql<Appointment[]>`select * from appointments where id = ${appt.id}`;
  if (!row) return null;
  const was = humanSlot(new Date(appt.starts_at), clinic.timezone);
  const told = (ids: Array<string | null>) => noticesToldInChat(ids);
  if (row.smile_sync === "revisar") {
    await told([row.id]);
    return { ok: false, pendiente_recepcion: true, turno_id: row.id,
      mensaje: `La agenda no pudo confirmar el pedido y quedó en recepción, que lo revisa y le escribe. Hasta entonces el turno del ${was} sigue como estaba. No crees otra tarea.` };
  }
  if (row.smile_management) return null;
  if (request.operation === "cancelar") {
    if (row.status !== "cancelado") return null;
    const sent = await told([row.id]);
    return { ok: true, turno_id: row.id,
      mensaje: `Cancelación confirmada: el turno del ${was} quedó cancelado.${sent ? " Ya le llegó el aviso por WhatsApp: decile solo que quedó hecho." : ""}` };
  }
  if (row.status === "reprogramado" && row.replaced_by) {
    const [moved] = await sql<Array<Appointment & { professional: string }>>`
      select a.*, p.full_name as professional from appointments a join professionals p on p.id = a.professional_id where a.id = ${row.replaced_by}`;
    if (!moved) return null;
    const sent = await told([row.id, moved.id]);
    return { ok: true, turno_id: moved.id, direccion: clinic.address,
      mensaje: `Cambio confirmado: el turno quedó para el ${humanSlot(new Date(moved.starts_at), clinic.timezone)} con ${moved.professional}.${sent ? " Ya le llegó el aviso por WhatsApp: decile solo que quedó hecho." : ""}` };
  }
  if (ACTIVE.includes(row.status) && row.smile_sync === "ok") {
    // El horario pedido se ocupó antes de escribirlo: el turno sigue donde estaba.
    await told([row.id]);
    return { ok: false, ocupado: true, turno_id: row.id,
      mensaje: `El horario pedido se ocupó recién: el turno sigue el ${was}. Decíselo en una línea y ofrecé buscar otro horario.` };
  }
  return null;
}

async function requestSmileManagement(appt: Appointment, request: SmileManagement, ctx?: ToolContext) {
  assertNotOver(appt);
  if (!/^sc:\d+$/.test(appt.external_id ?? "") || appt.second_professional_id) {
    throw new SmileHandoff("Recepción tiene que verificar ese turno antes de aplicar el cambio.", `Revisar el turno ${appt.id} para ${request.operation}.`);
  }
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${`smile-connect:${appt.clinic_id}`}, 0))`;
    if (!(await usesSmileManagement(appt.clinic_id, tx))) {
      throw new SmileHandoff("La configuración de la agenda cambió. Recepción tiene que revisar el pedido.", `Revisar el turno ${appt.id} para ${request.operation}.`);
    }
    const [current] = await tx<Appointment[]>`select * from appointments where id = ${appt.id} for update`;
    if (!current || !ACTIVE.includes(current.status) || current.starts_at !== appt.starts_at || current.ends_at !== appt.ends_at
      || current.professional_id !== appt.professional_id || current.second_professional_id !== appt.second_professional_id
      || current.external_id !== appt.external_id || current.patient_id !== appt.patient_id
      || current.appointment_type_id !== appt.appointment_type_id || current.notes !== appt.notes || current.title !== appt.title) {
      throw new ToolError("Ese turno cambió recién. Volvé a consultar sus datos.");
    }
    if (current.smile_management) {
      if (current.smile_management.operation !== request.operation || (request.operation === "mover"
        && current.smile_management.operation === "mover"
        && (current.smile_management.startsAt !== request.startsAt || current.smile_management.professionalId !== request.professionalId))) {
        throw new ToolError("Este turno ya tiene otro pedido pendiente. Esperá el resultado antes de intentar otro cambio.");
      }
      return;
    }
    await tx`
      update appointments set smile_management = ${json(request)}, smile_sync = 'pendiente', smile_attempts = 0, smile_error = null
      where id = ${appt.id}`;
  });
  // Por chat, Sofi espera el resultado para contestarlo en el mismo mensaje; si no llega, sigue pendiente.
  if (ctx ? await settleInChat(appt.clinic_id, appt.id, ctx) : (processSmileBookingLater(appt.clinic_id, appt.id), false)) {
    const settled = await settledManagement(appt, request);
    if (settled) return { segundo_turno_id: undefined, aviso: undefined, avisados_lista_espera: 0, ...settled };
  }
  return {
    ok: false, pendiente_confirmacion: true, turno_id: appt.id, segundo_turno_id: undefined,
    aviso: undefined, avisados_lista_espera: 0,
    mensaje: request.via === "telefono"
      ? "Pedido de cambio guardado. Antes de despedirte, llamá una vez a consultar_estado_turno con este turno_id. No confirmes el cambio ni vuelvas a afirmar que conserva el horario anterior sin comprobar el resultado."
      : request.replyPhone
      ? "Pedido recibido. Decile al paciente, en una línea, que le avisás por acá apenas quede hecho el cambio y que hasta entonces sigue el turno de antes. No repitas el pedido."
      : "Pedido recibido. El cambio sigue pendiente de verificación en la agenda. No lo confirmes todavía ni repitas el pedido.",
  };
}

async function cancelLoaded(
  clinic: Clinic,
  patient: Patient,
  appt: Appointment,
  motivo: string | undefined,
  by: "paciente" | "clinica",
  /** Por dónde se cancela (el canal de Sofi o «panel»): el resumen diario cuenta solo lo que hizo Sofi. */
  via: string,
) {
  assertNotOver(appt);
  const notes = [appt.notes, motivo && `Cancelado: ${motivo}`].filter(Boolean).join(" | ");
  // Solo si sigue activo: si otro canal lo canceló o movió recién, no se pisa.
  const [done] = await sql`
    update appointments set status = 'cancelado', cancelled_at = now(), notes = ${notes || null}, cancelled_via = ${via}
    where id = ${appt.id} and status = any(${ACTIVE}::text[]) returning id`;
  if (!done) throw new ToolError("Ese turno ya no está activo: se canceló o se reprogramó recién.");
  await sql`update waitlist set status = 'cancelada' where appointment_id = ${appt.id} and status in ('activa', 'ofrecida')`;
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
  assertNotOver(appt);
  const notice = clinic.cancel_notice_hours;
  if (notice && !ctx.staff && Date.parse(appt.starts_at) - Date.now() < notice * 3600_000) {
    throw new ToolError(
      `Faltan menos de ${notice} ${notice === 1 ? "hora" : "horas"} para el turno: según las reglas del consultorio, la cancelación la gestiona recepción. Creá una tarea de derivacion_humana con el pedido y aclarale al paciente que el turno sigue reservado hasta que recepción le confirme.`,
    );
  }
  const via = sourceFromChannel(ctx.channel, ctx.patientPhone);
  if (await usesSmileManagement(clinic.id)) {
    // Las visitas combinadas (dos prácticas seguidas) las coordina recepción también al cancelar.
    if (await inCombinedVisit(appt)) {
      throw new SmileHandoff("La cancelación de esta visita combinada la coordina recepción. El turno sigue reservado.", `Cancelar la visita combinada del turno ${appt.id}. ${input.motivo ?? ""}`);
    }
    return requestSmileManagement(appt, { operation: "cancelar", via, reason: input.motivo ?? null, replyPhone: smileReplyPhone(ctx, via) }, ctx);
  }
  if (await usesLiveSmile(clinic.id)) {
    throw new SmileHandoff("La cancelación la confirma recepción. El turno sigue reservado.", `Cancelar el turno ${appt.id} en Smile Connect. ${input.motivo ?? ""}`);
  }
  const follower = await followerOf(appt);
  const { when, offered } = await cancelLoaded(clinic, patient, appt, input.motivo, ctx.staff ? "clinica" : "paciente", sourceFromChannel(ctx.channel, ctx.patientPhone));
  const [next] = follower ? await sql<Array<{ name: string }>>`select name from appointment_types where id = ${follower.appointment_type_id}` : [];
  return {
    ok: true,
    mensaje: `Turno del ${when} cancelado. Ofrecé reprogramarlo.`,
    avisados_lista_espera: offered,
    ...(follower && {
      aviso: `En la misma visita, a continuación, tiene ${next?.name ?? "otra práctica"} (turno_id=${follower.id}), que sigue reservada. Preguntale si también la cancela.`,
    }),
  };
}

/** Panel: la clínica cancela un turno. Igual que si lo cancela el paciente: avisa a n8n y ofrece el hueco. */
export async function cancelClinicAppointment(clinicId: string, appointmentId: string, motivo?: string) {
  const clinic = await getClinic(clinicId);
  const { patient, appt } = await getClinicAppointment(clinicId, appointmentId);
  if (await usesSmileManagement(clinicId)) {
    return requestSmileManagement(appt, { operation: "cancelar", via: "panel", reason: motivo ?? null, replyPhone: null });
  }
  const { when, offered } = await cancelLoaded(clinic, patient, appt, motivo, "clinica", "panel");
  return {
    ok: true,
    mensaje: `Turno del ${when} cancelado.${offered ? ` Se le ofreció el horario a ${offered === 1 ? "1 persona" : `${offered} personas`} de la lista de espera.` : ""}`,
  };
}

/** Cuando se libera un turno, se lo ofrecemos por WhatsApp a quienes esperan (flujo "Activa"). */
export async function offerFreedSlot(clinic: Clinic, appt: Appointment): Promise<number> {
  if (!agentBookingDayAllowed(clinic.booking_weekdays, new Date(appt.starts_at), clinic.timezone)) return 0;
  if (new Date(appt.starts_at).getTime() < Date.now() + 2 * 3600_000) return 0;
  const template = clinic.templates?.lista_espera ?? (clinic.whatsapp_provider === "waha" ? "lista_espera" : null);
  if (!template || whatsappReadiness(clinic)) return 0;

  const entries = await sql<Array<{ id: string; patient_id: string; appointment_id: string | null; professional_id: string | null; full_name: string | null; phone: string | null }>>`
    select w.id, w.patient_id, w.appointment_id, w.professional_id, p.full_name, p.phone
    from waitlist w join patients p on p.id = w.patient_id
    left join appointments current on current.id = w.appointment_id and current.clinic_id = w.clinic_id and current.patient_id = w.patient_id
    where w.clinic_id = ${clinic.id} and w.status = 'activa' and w.appointment_type_id = ${appt.appointment_type_id}
      and (w.appointment_id is null or (current.status = 'confirmado' and current.starts_at > ${appt.starts_at}))
      and w.patient_id <> ${appt.patient_id}
    order by w.created_at
    limit 10`;

  const candidates = entries
    .filter((e) => !e.professional_id || e.professional_id === appt.professional_id)
    .filter((e): e is typeof e & { phone: string } => /^\d+$/.test(e.phone ?? ""))
    .slice(0, 3);

  const when = humanSlot(new Date(appt.starts_at), clinic.timezone);
  let sent = 0;
  for (const entry of candidates) {
    const phone = entry.phone;
    const context = entry.appointment_id
      ? `Se liberó ${when} para adelantar su turno existente (turno_id=${entry.appointment_id}, profesional_id=${appt.professional_id}, inicio=${appt.starts_at}). Antes de ofrecerlo, verificá consultar_disponibilidad con ese turno_id. Si confirma, usá reprogramar_turno; nunca reservar_turno ni cancelar el original para simular un cambio.`
      : `Le escribimos para ofrecerle un turno que se liberó: ${when} (profesional_id=${appt.professional_id}, tipo_turno_id=${appt.appointment_type_id}, inicio=${appt.starts_at}). Si lo quiere, reservalo enseguida porque se ofreció a varias personas.`;
    try {
      if (entry.appointment_id) {
        const offers = await checkAvailability({ clinicId: clinic.id, patientPhone: phone, patientId: entry.patient_id, channel: "whatsapp" }, {
          turno_id: entry.appointment_id, profesional_id: appt.professional_id,
          desde: localDateKey(new Date(appt.starts_at), clinic.timezone), hasta: localDateKey(new Date(appt.starts_at), clinic.timezone),
          hora_exacta: clockTime(new Date(appt.starts_at), clinic.timezone),
        });
        if (!offers.turnos.some((s) => Date.parse(s.inicio) === Date.parse(appt.starts_at))) continue;
      }
      await sendPatientMessage(clinic, {
        phone,
        templateKey: "lista_espera",
        templateName: template,
        params: [entry.full_name?.split(" ")[0] || "hola", when],
        context,
        patientId: entry.patient_id,
        ...(entry.appointment_id && { text: "Se liberó un horario el " + when + " para adelantar su turno. Si le sirve, responda este mensaje y verificamos el cambio." }),
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
  /** La práctica que sigue en la misma visita: se mueve junto con este turno. */
  follower?: Appointment,
  /** Lo mueve el consultorio desde el panel. */
  byPanel = false,
  /** Por dónde se mueve (lo cuenta el resumen diario); por defecto, el panel o el canal del paciente. */
  via: string = byPanel ? "panel" : source,
  management?: { via: AppointmentSource; replyPhone: string | null },
  /** Quien lo pide por chat: espera el resultado de Smile Connect para contestarlo. */
  ctx?: ToolContext,
) {
  assertNotOver(appt);
  const professionalId = input.profesional_id || appt.professional_id;
  const startsAt = new Date(input.nuevo_inicio);
  // Un turno con dos profesionales se mueve para los dos.
  if (appt.second_professional_id && appt.second_professional_id === professionalId) {
    throw new ToolError("Ese profesional ya atiende este turno como segundo profesional: elegí otro.");
  }
  const preserve = clinic.keep_duration_on_reschedule;
  const customDuration = keptDuration(appt, preserve);
  const moving = follower ? [appt.id, follower.id] : appt.id;
  if (management && (follower || appt.second_professional_id)) {
    throw new SmileHandoff("Recepción coordina el cambio de esta visita combinada.", `Reprogramar la visita del turno ${appt.id}.`);
  }
  const { type, pro, second, endsAt } = await assertBookable(clinic, professionalId, appt.appointment_type_id, startsAt, {
    ignoreAppointmentId: moving,
    force,
    secondProfessionalId: appt.second_professional_id,
    durationMin: customDuration,
    byPanel,
    deferSmile: Boolean(management),
  });
  let next: (Awaited<ReturnType<typeof assertBookable>> & { startsAt: Date }) | null = null;
  if (follower) {
    try {
      next = {
        ...(await assertBookable(clinic, pro.id, follower.appointment_type_id, endsAt, { ignoreAppointmentId: moving, force, durationMin: keptDuration(follower, preserve), byPanel })),
        startsAt: endsAt,
      };
    } catch (e) {
      if (!(e instanceof ToolError)) throw e;
      throw new ToolError(
        `En la misma visita sigue otra práctica y a continuación no entra (${e.message.replace(AGAIN, "")}) Consultá la disponibilidad con las dos prácticas (segundo_tipo_turno_id) y ofrecé otra opción.`,
        e.forzable,
        e.panelMessage,
      );
    }
  }
  const visitEnd = next?.endsAt ?? endsAt;
  // Con otro profesional, que atienda la cobertura del turno.
  const coverage = pro.id === appt.professional_id
    ? appt.coverage
    : coverageFor(await getCatalog(clinic.id), pro, [type, ...(next ? [next.type] : [])], appt.coverage, planFor(patient, appt.coverage), byPanel).coverage;
  const clash = (await upcomingOf(patient.id)).find(
    (a) => a.id !== appt.id && a.id !== follower?.id && new Date(a.starts_at) < visitEnd && new Date(a.ends_at) > startsAt,
  );
  if (clash) {
    throw new ToolError(`El paciente ya tiene otro turno a esa hora: ${clash.type_name} con ${clash.professional} el ${humanSlot(new Date(clash.starts_at), clinic.timezone)}.`);
  }
  if (management) {
    if (pro.id === appt.professional_id && startsAt.getTime() === Date.parse(appt.starts_at)) {
      throw new ToolError("El turno ya está en ese horario.");
    }
    return requestSmileManagement(appt, {
      operation: "mover", ...management, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), professionalId: pro.id, coverage,
    }, ctx);
  }

  // En una transacción: liberamos el turno viejo (puede superponerse con el
  // nuevo) y reservamos el nuevo. Si algo falla, el viejo queda como estaba.
  let newAppt: Appointment;
  let newNext: Appointment | null = null;
  try {
    [newAppt, newNext] = await sql.begin(async (tx) => {
      await lockProfessionals(tx, [appt.professional_id, pro.id, ...(second ? [second.id] : [])]);
      const ids = follower ? [appt.id, follower.id] : [appt.id];
      const freed = await tx<Appointment[]>`
        update appointments set status = 'reprogramado', cancelled_at = now(), cancelled_via = ${via}
        where id = any(${ids}::uuid[]) and status = any(${ACTIVE}::text[]) returning *`;
      if (freed.length < ids.length) throw new ToolError("Ese turno ya no está activo: se canceló o se reprogramó recién.");
      // Smile Connect puede cambiar una práctica o su duración mientras se busca el nuevo horario.
      if ([appt, ...(follower ? [follower] : [])].some((before) => {
        const current = freed.find((a) => a.id === before.id)!;
        return current.starts_at !== before.starts_at || current.ends_at !== before.ends_at
          || current.professional_id !== before.professional_id || current.second_professional_id !== before.second_professional_id
          || current.patient_id !== before.patient_id || current.appointment_type_id !== before.appointment_type_id
          || current.notes !== before.notes || current.title !== before.title;
      })) throw new ToolError("Ese turno cambió recién. Volvé a consultar el turno y la disponibilidad.");
      const row = (t: Appointment, p: { pro: { id: string }; second: { id: string } | null; type: { id: string }; endsAt: Date }, at: Date) => ({
        clinic_id: clinic.id,
        patient_id: patient.id,
        professional_id: p.pro.id,
        second_professional_id: p.second?.id ?? null,
        appointment_type_id: p.type.id,
        starts_at: at.toISOString(),
        ends_at: p.endsAt.toISOString(),
        status: "confirmado" as const,
        source,
        coverage,
        notes: t.notes,
        title: t.title ?? null,
      });
      const moved = await insertAppointment(tx, row(appt, { pro, second, type, endsAt }, startsAt));
      const movedNext = follower && next ? await insertAppointment(tx, row(follower, next, next.startsAt)) : null;
      // Cuál reemplaza a cuál: el resumen diario dice «antes → ahora» (y la escritura en Smile Connect mueve el mismo turno).
      await tx`update appointments set replaced_by = ${moved.id} where id = ${appt.id}`;
      await tx`update waitlist set appointment_id = ${moved.id} where appointment_id = ${appt.id} and status in ('activa', 'ofrecida')`;
      if (follower && movedNext) await tx`update appointments set replaced_by = ${movedNext.id} where id = ${follower.id}`;
      return [moved, movedNext] as const;
    });
  } catch (e) {
    if (isOverlapError(e)) throw new ToolError("Ese horario se acaba de ocupar. Consultá la disponibilidad de nuevo.");
    throw e;
  }
  await notifyN8n("turno.reprogramado", { clinic_id: clinic.id, before: appt, after: newAppt, patient });
  if (follower && newNext) await notifyN8n("turno.reprogramado", { clinic_id: clinic.id, before: follower, after: newNext, patient });
  for (const freed of follower ? [appt, follower] : [appt]) await offerFreedSlot(clinic, freed).catch(() => 0);
  return {
    ok: true,
    turno_id: newAppt.id,
    ...(newNext && { segundo_turno_id: newNext.id }),
    mensaje: `Listo: el turno pasó al ${humanSlot(startsAt, clinic.timezone)} con ${pro.full_name}${second ? ` y ${second.full_name}` : ""}${
      next ? `, y ${next.type.name} sigue a continuación, hasta las ${clockTime(next.endsAt, clinic.timezone)}` : ""
    }.`,
  };
}

/** Smile Connect y las reprogramaciones de Guerra–Mininni conservan la duración registrada. */
function keptDuration(appt: Appointment, preserve = false): number | undefined {
  const minutes = (Date.parse(appt.ends_at) - Date.parse(appt.starts_at)) / 60_000;
  if (preserve) return minutes;
  return appt.source === "smile_connect" && minutes >= 5 && minutes <= 480 ? Math.round(minutes) : undefined;
}

/**
 * La práctica que sigue en la misma visita: mismo paciente y profesional, empieza cuando termina este
 * turno. Para moverla junto con el turno, solo si el agente la puede mover (no la da solo el consultorio).
 */
async function followerOf(appt: Appointment, opts: { movable?: { move_panel_only: boolean } } = {}): Promise<Appointment | undefined> {
  if (appt.second_professional_id) return undefined;
  const [row] = await sql<Appointment[]>`
    select a.* from appointments a join appointment_types t on t.id = a.appointment_type_id
    where a.patient_id = ${appt.patient_id} and a.professional_id = ${appt.professional_id} and a.id <> ${appt.id}
      and a.second_professional_id is null and a.status = any(${ACTIVE}::text[]) and a.starts_at = ${appt.ends_at}
      ${opts.movable ? sql`and t.agent_can_reschedule and (not t.panel_only or ${opts.movable.move_panel_only})` : sql``}
    limit 1`;
  return row;
}

/** El turno anterior de la misma visita combinada (otra práctica que termina justo cuando empieza esta). */
async function predecessorOf(appt: Appointment): Promise<Appointment | undefined> {
  if (appt.second_professional_id) return undefined;
  const [row] = await sql<Appointment[]>`
    select * from appointments
    where patient_id = ${appt.patient_id} and professional_id = ${appt.professional_id} and id <> ${appt.id}
      and second_professional_id is null and status = any(${ACTIVE}::text[]) and ends_at = ${appt.starts_at}
    limit 1`;
  return row;
}

/** Si el turno es parte de una visita combinada (dos prácticas seguidas, en cualquier orden). */
async function inCombinedVisit(appt: Appointment): Promise<boolean> {
  return Boolean((await followerOf(appt)) ?? (await predecessorOf(appt)));
}

async function loadReschedule(ctx: ToolContext, clinic: Clinic, id: string) {
  const { patient, appt } = await getOwnAppointment(ctx, id);
  assertNotOver(appt);
  // El equipo del consultorio es recepción: mueve la visita entera, sin las reglas de abajo.
  if (ctx.staff) return { patient, appt, follower: await followerOf(appt) };
  // La práctica que sigue en la misma visita se mueve con este turno, si Sofi la puede mover.
  const follower = await followerOf(appt, { movable: clinic });
  const parts = follower ? [appt, follower] : [appt];
  const types = await sql<Array<Pick<AppointmentType, "id" | "name" | "panel_only" | "agent_can_reschedule">>>`
    select id, name, panel_only, agent_can_reschedule from appointment_types where id = any(${parts.map((a) => a.appointment_type_id)}::uuid[])`;
  const refer = "Creá una tarea de derivacion_humana para que recepción coordine el cambio. El turno original sigue reservado.";
  const type = types.find((t) => t.id === appt.appointment_type_id);
  if (type && !agentCanMove(type, clinic)) {
    // Lo que da solo el consultorio se explica como siempre.
    if (type.panel_only && !clinic.move_panel_only) assertAgentCanBook(type);
    throw new ToolError(`El cambio de «${type.name}» lo coordina recepción. ${refer}`);
  }
  // Reglas del consultorio (Panel → Configuración → Turnos y urgencias).
  const terms = parseTerms(clinic.reception_only_terms);
  if (terms.length) {
    for (const a of parts) {
      const name = types.find((t) => t.id === a.appointment_type_id)?.name ?? "";
      // Las notas cuentan en los turnos que cargó el consultorio (a mano o desde Smile Connect).
      const labels = [name, a.title, a.source === "smile_connect" || a.source === "panel" ? a.notes : null];
      const term = labels.map((label) => receptionOnlyTerm(label, terms)).find(Boolean);
      if (term) throw new ToolError(`El cambio de un turno de ${term} lo coordina recepción. ${refer}`);
    }
  }
  const max = clinic.reschedule_max_minutes;
  if (max && Date.parse((follower ?? appt).ends_at) - Date.parse(appt.starts_at) > max * 60_000) {
    throw new ToolError(`El cambio de una visita de más de ${durationPhrase(max)} lo coordina recepción. ${refer}`);
  }
  const notice = clinic.reschedule_notice_hours;
  if (notice && Date.parse(appt.starts_at) - Date.now() < notice * 3600_000) {
    throw new ToolError(`Faltan menos de ${notice} ${notice === 1 ? "hora" : "horas"} para el turno. ${refer}`);
  }
  return { patient, appt, follower };
}

export async function rescheduleAppointment(ctx: ToolContext, input: { turno_id: string; nuevo_inicio: string; profesional_id?: string }) {
  const clinic = await getClinic(ctx.clinicId);
  const { patient, appt, follower } = await loadReschedule(ctx, clinic, input.turno_id);
  const via = sourceFromChannel(ctx.channel, ctx.patientPhone);
  if (await usesSmileManagement(clinic.id)) {
    if (follower || (await predecessorOf(appt))) throw new SmileHandoff("Recepción coordina el cambio de esta visita combinada.", `Reprogramar la visita del turno ${appt.id}.`);
    return rescheduleLoaded(clinic, patient, appt, input, ctx.staff ? appt.source : via, false, undefined, Boolean(ctx.staff), via, {
      via, replyPhone: smileReplyPhone(ctx, via),
    }, ctx);
  }
  if (await usesLiveSmile(clinic.id)) {
    throw new SmileHandoff("El cambio lo confirma recepción. El turno original sigue reservado.", `Reprogramar el turno ${appt.id}. Horario pedido: ${input.nuevo_inicio}.`);
  }
  // El equipo mueve como el consultorio: el turno conserva por dónde lo pidió el paciente.
  const r = ctx.staff
    ? await rescheduleLoaded(clinic, patient, appt, input, appt.source, false, follower, true, sourceFromChannel(ctx.channel, ctx.patientPhone))
    : await rescheduleLoaded(clinic, patient, appt, input, sourceFromChannel(ctx.channel, ctx.patientPhone), false, follower);
  return { ...r, ok: true };
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
  const managed = await usesSmileManagement(clinicId);
  return rescheduleLoaded(clinic, patient, appt, input, appt.source, opts.force, undefined, true, "panel",
    managed ? { via: "panel", replyPhone: null } : undefined);
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
    patientId = ctx.appointmentPatientId ?? (await ensurePatient(ctx)).id;
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
// silenciar_numero (vendedores, publicidad y bots que escriben al WhatsApp)
// ---------------------------------------------------------------------------
export async function muteSender(ctx: ToolContext, input: { motivo: "vendedor" | "bot"; detalle?: string }) {
  if (ctx.staff) throw new ToolError("Es alguien del equipo del consultorio: no se silencia.");
  const source = sourceFromChannel(ctx.channel, ctx.patientPhone);
  if (source !== "whatsapp") {
    return { ok: false, error: "Solo sirve en el chat. En una llamada, despedite amablemente y cortá." };
  }
  // Un paciente con turnos o visitas nunca se silencia, aunque escriba algo raro.
  const patient = await currentPatient(ctx);
  if (patient) {
    const [known] = await sql`
      select 1 from appointments where patient_id = ${patient.id}
      union all select 1 from patient_visits where patient_id = ${patient.id}
      limit 1`;
    if (known) throw new ToolError("Es un paciente del consultorio (tiene turnos o visitas): no lo silencies, atendelo normalmente.");
  }
  const phone = normalizePhone(ctx.patientPhone);
  await muteNumber(ctx.clinicId, phone, input.motivo, input.detalle?.trim() || (input.motivo === "bot" ? "Mensajes automáticos." : "Ofrecía algo al consultorio."), CHAT_LIMITS.muteDays * 24);
  console.warn(JSON.stringify({ evento: "limite_chat", tipo: input.motivo, clinica: ctx.clinicId, conversacion: ctx.conversationId }));
  return { ok: true, mensaje: `Listo: este número queda en silencio ${CHAT_LIMITS.muteDays} días. Si todavía no le contestaste, mandale la respuesta de una línea y no sigas la charla.` };
}

// ---------------------------------------------------------------------------
// anotar_lista_espera
// ---------------------------------------------------------------------------
// Como hace la secretaria: primero un turno reservado y la lista de espera es para adelantarlo.
// Así el paciente no cree que estar anotado le asegura un turno antes, ni se queda sin ninguno.
export async function joinWaitlist(ctx: ToolContext, input: { tipo_turno_id?: string; turno_id?: string; profesional_id?: string; preferencias?: string;
  sin_turno?: "no_hay_horarios" | "no_quiere_turno" }) {
  if (Boolean(input.tipo_turno_id) === Boolean(input.turno_id)) throw new ToolError("Usá tipo_turno_id o turno_id, solo uno.");
  const clinic = await getClinic(ctx.clinicId);
  const move = input.turno_id ? await loadReschedule(ctx, clinic, input.turno_id) : null;
  const patient = move?.patient ?? await ensurePatient(ctx);
  const catalog = await getCatalog(ctx.clinicId);
  const waitType = catalog.appointmentTypes.find((t) => t.id === (move?.appt.appointment_type_id ?? input.tipo_turno_id));
  if (!waitType) throw new ToolError("Tipo de turno inválido.");
  if (!move) assertAgentCanBook(waitType);
  if (!move && !ctx.staff) {
    const [held] = await sql<Array<{ id: string; starts_at: string }>>`select id, starts_at from appointments
      where clinic_id = ${ctx.clinicId} and patient_id = ${patient.id} and appointment_type_id = ${waitType.id}
        and status in ('confirmado', 'pendiente') and starts_at > now() order by starts_at limit 1`;
    if (held) throw new ToolError(`Ya tiene turno de «${waitType.name}» el ${humanSlot(new Date(held.starts_at), clinic.timezone)}: `
      + `anotalo con turno_id=${held.id} para adelantar ese turno.`);
    if (!input.sin_turno) throw new ToolError("Antes de la lista de espera, reservale un turno: el primer horario que le sirva de "
      + "consultar_disponibilidad, con reservar_turno. Después anotalo con el turno_id de esa reserva, por si se libera algo antes. "
      + "Sin turno, solo si consultar_disponibilidad no devolvió ningún horario o si no quiso ninguno de los que le ofreciste: entonces sin_turno.");
  }
  if (input.profesional_id && !catalog.professionals.some((p) => p.id === input.profesional_id)) throw new ToolError("Profesional inválido.");
  const professionalId = input.profesional_id ?? move?.appt.professional_id ?? null;
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${"waitlist:" + ctx.clinicId + ":" + patient.id}::text, 0))`;
    const [existing] = await tx`select id from waitlist where clinic_id = ${ctx.clinicId} and patient_id = ${patient.id}
      and appointment_type_id = ${waitType.id} and appointment_id is not distinct from ${move?.appt.id ?? null}::uuid
      and professional_id is not distinct from ${professionalId}::uuid and status in ('activa', 'ofrecida') limit 1`;
    if (existing) await tx`update waitlist set preferences = coalesce(${input.preferencias ?? null}, preferences) where id = ${existing.id}`;
    else await tx`insert into waitlist (clinic_id, patient_id, appointment_type_id, appointment_id, professional_id, preferences)
      values (${ctx.clinicId}, ${patient.id}, ${waitType.id}, ${move?.appt.id ?? null}, ${professionalId}, ${input.preferencias ?? null})`;
  });
  return { ok: true, mensaje: move
    ? "Anotado en lista de espera para adelantar ese turno, que sigue reservado. Decile que conserva ese turno y que, si se libera un lugar antes, le escribimos por WhatsApp. No le prometas que lo van a adelantar."
    : "Anotado en lista de espera, sin turno reservado. Decile que todavía no tiene turno y que la lista de espera no le asegura uno: si se libera un lugar, le escribimos por WhatsApp." };
}

/** Consulta el resultado ya verificado por el proceso de Smile Connect; no repite escrituras. */
export async function appointmentManagementStatus(ctx: ToolContext, input: { turno_id: string }) {
  const patient = ctx.staff ? null : await appointmentPatient(ctx);
  if (!ctx.staff && !patient) throw new ToolError("No encontré al paciente.");
  if (!isUuid(input.turno_id)) throw new ToolError("No encontré ese turno.");
  const read = async (id: string) => (await sql<Array<Appointment & { professional: string }>>`
    select a.*, p.full_name as professional from appointments a join professionals p on p.id = a.professional_id
    where a.id = ${id} and a.clinic_id = ${ctx.clinicId}
      ${patient ? sql`and a.patient_id = ${patient.id}` : sql``}`)[0];
  let row = await read(input.turno_id);
  if (!row) throw new ToolError("No encontré ese turno para este paciente.");
  const pending = (a: Appointment) => Boolean(a.smile_management) || ["pendiente", "error"].includes(a.smile_sync ?? "")
    || (a.status === "pendiente" && a.smile_deferred);
  const voice = sourceFromChannel(ctx.channel, ctx.patientPhone) === "telefono";
  if (voice && pending(row) && row.smile_sync !== "revisar") {
    // El trabajo corre después de la herramienta anterior. Espera acotada, por debajo de los 20 s de ElevenLabs.
    await new Promise((resolve) => setTimeout(resolve, 4000));
    row = await read(input.turno_id);
    if (!row) throw new ToolError("Ese turno cambió. Recepción debe comprobar el resultado.");
  }
  if (row.status === "reprogramado" && row.replaced_by) {
    const replacement = await read(row.replaced_by);
    if (!replacement || replacement.patient_id !== row.patient_id) throw new ToolError("Recepción debe comprobar el resultado del cambio.");
    row = replacement;
  }
  if (row.smile_sync === "revisar") return { ok: false, pendiente_recepcion: true,
    mensaje: "La gestión necesita revisión de recepción. No afirmes que conserva el horario anterior ni que el cambio se hizo." };
  if (pending(row)) {
    const whatsapp = voice ? await clinicWhatsappStatus(ctx.clinicId) : null;
    if (voice && !whatsapp?.ready) {
      await sql`with claimed as (
        insert into channel_events (key) values (${"confirm-call:" + ctx.clinicId + ":" + input.turno_id})
        on conflict do nothing returning key)
        insert into tasks (clinic_id, patient_id, conversation_id, type, title, details)
        select ${ctx.clinicId}, ${row.patient_id}, ${ctx.conversationId ?? null}, 'derivacion_humana',
          'Confirmar al paciente el resultado del turno',
          ${"El pedido " + input.turno_id + " seguía pendiente al consultar por teléfono y WhatsApp no estaba disponible. Comprobar el estado actual antes de contactar al paciente."}
        from claimed`;
      return { ok: false, pendiente_confirmacion: true, pendiente_recepcion: true,
        mensaje: "El pedido está guardado pero la agenda todavía no terminó de verificarlo. Recepción tiene el pedido para comprobar el resultado y contactarlo. No prometas un WhatsApp ni confirmes un horario." };
    }
    return { ok: false, pendiente_confirmacion: true, mensaje: voice
      ? "El pedido sigue pendiente de verificación. Decile que la confirmación le llegará por WhatsApp al número desde el que llamó. Nombrá ese canal explícitamente y no vuelvas a afirmar el horario anterior."
      : "El pedido sigue pendiente de verificación. Le avisás por este WhatsApp cuando quede resuelto. No repitas la gestión." };
  }
  if (!["confirmado", "cancelado"].includes(row.status)) {
    return { ok: false, pendiente_recepcion: true, mensaje: "Ese turno cambió y no hay un resultado final verificable en esta consulta. Recepción debe comprobar el horario vigente. No confirmes el horario anterior." };
  }
  const clinic = await getClinic(ctx.clinicId);
  const when = humanSlot(new Date(row.starts_at), clinic.timezone);
  return { ok: true, estado: row.status, turno_id: row.id, cuando: when, profesional: row.professional,
    mensaje: row.status === "cancelado"
      ? "Cancelación confirmada. El turno del " + when + " quedó cancelado."
      : row.status === "confirmado"
        ? "Confirmado: el turno vigente es el " + when + " con " + row.professional + ". Comunicá este resultado antes de despedirte."
        : "El estado actual del turno es " + row.status + ". No afirmes otro resultado." };
}

// ---------------------------------------------------------------------------
// guardar_ficha_salud
// ---------------------------------------------------------------------------
export async function saveHealthForm(ctx: ToolContext, input: HealthFormInput & { fecha_nacimiento?: string; email?: string }) {
  const clinic = await getClinic(ctx.clinicId);
  if (!healthFormSheet(clinic)) {
    throw new ToolError("Esta clínica no usa la ficha de salud por chat: el paciente la completa en el consultorio.");
  }
  const patient = await ensurePatient(ctx);
  const { fecha_nacimiento, email, ...answers } = input;
  const birthDate = parseDateKey(fecha_nacimiento);
  const answered = Object.values(answers).some((v) => v !== undefined && v !== "" && v !== false) || Boolean(birthDate || email);
  const latest = await latestHealthForm(patient.id);

  // Sin respuestas: pide la plantilla para mandársela (o ya la completó).
  if (!answered) {
    if (latest?.completed_at && Date.now() - new Date(latest.completed_at).getTime() < HEALTH_FORM_VALID_DAYS * 86400_000) {
      return {
        ok: true,
        completa: true,
        mensaje: `Ya completó la ficha de salud el ${formatDate(latest.completed_at, clinic.timezone)}. Si quiere corregir algo, guardá solo eso con esta herramienta.`,
      };
    }
    const open = latest && !latest.completed_at ? latest : null;
    const data = open?.data ?? {};
    // Si la pide el equipo del consultorio, no cuenta como enviada al paciente.
    if (!ctx.staff && open) await markHealthFormInvited(open.id);
    else if (!ctx.staff) {
      await sql`
        insert into patient_health_forms (clinic_id, patient_id, source, conversation_id, invited_at)
        values (${clinic.id}, ${patient.id}, ${sourceFromChannel(ctx.channel, ctx.patientPhone)}, ${ctx.conversationId ?? null}, now())`;
    }
    return {
      ok: true,
      completa: false,
      mensaje:
        "Mandale la plantilla tal cual al final de tu mensaje, desde «📋 FICHA DE SALUD» y sin cambiarle nada: le llega aparte para que la copie, la complete y te la mande.",
      plantilla: healthFormTemplate(data, patient),
    };
  }

  const saved = await saveHealthFormAnswers(patient, answers, {
    source: sourceFromChannel(ctx.channel, ctx.patientPhone),
    conversationId: ctx.conversationId,
    fechaNacimiento: birthDate,
    email: email?.trim() || null,
  });
  if (saved.smileNotes) processSmileNotesLater(clinic.id);
  if (!saved.missing.length) {
    const biosafety = saved.form.data.bioseguridad === "si"
      ? " Pidió conocer las normas de bioseguridad del consultorio: si la información de la clínica las menciona, contáselas; si no, decile que se las cuentan en el consultorio."
      : "";
    return {
      ok: true,
      completa: true,
      mensaje: `${saved.wasComplete ? "Ficha de salud corregida." : "Ficha de salud completa y guardada."} El consultorio la imprime para que la firme cuando venga. Agradecele en una línea; no comentes sus respuestas ni des indicaciones médicas.${biosafety}`,
    };
  }
  return {
    ok: true,
    completa: false,
    faltan: saved.missing,
    mensaje:
      "Guardé lo que respondió. Pedile solo lo que falta (en «faltan»): si son uno o dos datos, preguntalos en una línea; si son más, mandale la plantilla tal cual al final del mensaje.",
    plantilla: healthFormTemplate(saved.form.data, saved.patient),
  };
}
