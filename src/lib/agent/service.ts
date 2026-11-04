import "server-only";
import { json, sql, pgErrorCode, type TransactionSql } from "../db";
import { getCatalog, getClinic, findPatientByPhone, getScheduleBlocks, isUuid, patientContextText, type Catalog } from "../clinic";
import { addHouseholdMember, findOrCreatePatientForPhone, identifyPatient, namesMatch, normalizeDni, sameCoverage, type Identification } from "../patients";
import { computeSlots, expandBlocks, isOpenAt, isSlotFree, type BusyInterval, type ScheduleBlock } from "../slots";
import { agentCanMove, agentSchedules, checkCoverage, coverageKey, durationPhrase, isParticular, parseTerms, professionalDoes, receptionOnlyTerm, schedulesForTypes } from "../booking-rules";
import { env } from "../env";
import { addDaysKey, humanSlot, localDateKey, parseDateKey, weekdayOfKey, zonedParts } from "../time";
import { normalizePhone } from "../phone";
import { sendPatientMessage, whatsappReadiness } from "../whatsapp";
import { notifyN8n } from "../n8n";
import { googleBusy } from "../calendar/sync";
import { appointmentAccessKey, expireAppointmentAccess, GUERRA_MININNI } from "./appointment-access";
import type { Appointment, AppointmentSource, AppointmentType, Clinic, Patient, Task, TaskPriority, TaskType } from "../types";


export type ToolContext = {
  clinicId: string;
  patientPhone: string;
  /** Panel: la ficha elegida (en un celular compartido, el familiar para el que es el turno). */
  patientId?: string;
  /** Autorización temporal resuelta por el servidor, solo para turnos existentes. */
  appointmentPatientId?: string;
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
  if (phone.startsWith("telegram:")) return "telegram";
  const c = (channel ?? "").toLowerCase();
  if (c === "panel") return "panel";
  // El Custom Channel de ElevenLabs solo se usa para WhatsApp por WAHA.
  if (c.includes("whatsapp") || c.includes("custom")) return "whatsapp";
  if (/(twilio|sip|phone|telephon|exotel)/.test(c)) return "telefono";
  if (phone.startsWith("web-")) return "web";
  return c ? "web" : "whatsapp";
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
  if (input.para_turno_existente && ctx.clinicId === GUERRA_MININNI && /^\d{10,15}$/.test(phone) && !appointmentAccessKey(ctx)) {
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
    franja?: "manana" | "tarde" | "cualquiera";
    cobertura?: string;
  },
) {
  const clinic = await getClinic(ctx.clinicId);
  const catalog = await getCatalog(clinic.id);
  const links = catalog.links ?? [];
  const move = input.turno_id ? await loadReschedule(ctx, clinic, input.turno_id) : null;
  const type = catalog.appointmentTypes.find((t) => t.id === (move?.appt.appointment_type_id ?? input.tipo_turno_id));
  if (!type) throw new ToolError("No encontré ese tipo de turno. Usá un id del catálogo.");
  const next = move
    ? catalog.appointmentTypes.find((t) => t.id === move.follower?.appointment_type_id) ?? null
    : secondTypeOf(catalog.appointmentTypes, type, input.segundo_tipo_turno_id);
  if (!move) {
    assertAgentCanBook(type);
    if (next) assertAgentCanBook(next);
  } else if (move.follower && !next) {
    throw new ToolError("Una práctica de esta visita ya no está disponible. El cambio lo tiene que coordinar recepción.");
  }
  const visit = next ? [type, next] : [type];
  // Lo que pide una prestación antes (por ejemplo, la consulta de implantes antes de la colocación).
  const patient = move ? move.patient : await currentPatient(ctx);
  if (!move) await assertPrerequisites(catalog, patient, visit);

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
  const wanted = move ? null : input.cobertura?.trim() || patient?.coverage?.trim() || null;
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

  const proIds = professionals.map((p) => p.id);
  const rangeStart = `${addDaysKey(fromKey, -1)}T00:00:00Z`;
  const rangeEnd = `${addDaysKey(toKey, 1)}T23:59:59Z`;
  const checkedPros = otherPro ? [...proIds, otherPro] : proIds;
  const movingIds = move ? [move.appt.id, ...(move.follower ? [move.follower.id] : [])] : [];
  const [busy, blocks, calendar, patientAppointments] = await Promise.all([
    busyOf(checkedPros, rangeStart, rangeEnd, movingIds),
    getScheduleBlocks(clinic.id, rangeStart, rangeEnd),
    // Lo ocupado en el Google Calendar de cada profesional (si la clínica lo conectó).
    googleBusy(clinic.id, checkedPros, new Date(rangeStart), new Date(rangeEnd), { timeZone: clinic.timezone }),
    move ? upcomingOf(move.patient.id) : [],
  ]);
  const preserve = clinic.keep_duration_on_reschedule && !!move;
  const firstDuration = (move && keptDuration(move.appt, preserve)) || type.duration_min;
  const nextDuration = (move?.follower && keptDuration(move.follower, preserve)) || next?.duration_min || 0;
  const duration = firstDuration + nextDuration;
  const blocked = expandBlocks(blocks, checkedPros);
  const otherSchedules = catalog.schedules.filter((s) => s.professional_id === otherPro);
  const otherBusy = [...busy, ...calendar, ...blocked].filter((b) => b.professional_id === otherPro);
  const ownBusy = patientAppointments.filter((a) => !movingIds.includes(a.id));

  // Los horarios que sirven para estas prestaciones. Las horas reservadas para urgencias solo
  // las usa un turno de urgencia, salvo que ya estén por empezar (se liberan cerca de la hora).
  const releaseUntil = clinic.urgent_release_hours ? now.getTime() + clinic.urgent_release_hours * 3600_000 : null;
  const usable = agentSchedules(
    catalog.schedules.filter((s) => proIds.includes(s.professional_id)),
    visit.map((t) => t.id),
    { urgent, released: releaseUntil !== null },
  );
  const releasedOk = (start: Date, block: ScheduleBlock) => urgent || !block.urgent_only || (releaseUntil !== null && start.getTime() <= releaseUntil);
  const slots = computeSlots({
    schedules: usable,
    busy: [...busy, ...calendar],
    blocked,
    // Dos prácticas en la misma visita: tienen que entrar las dos, una detrás de la otra.
    durationMin: duration,
    stepMin: move ? 15 : type.duration_min,
    accepts: (start, end, block) =>
      releasedOk(start, block) &&
      (!move ||
        ((selectedPro !== move.appt.professional_id || start.getTime() !== Date.parse(move.appt.starts_at)) &&
          !ownBusy.some((a) => start < new Date(a.ends_at) && end > new Date(a.starts_at)) &&
          (!otherPro || isSlotFree(otherSchedules, otherBusy, start, duration, clinic.timezone).ok))),
    fromKey,
    toKey,
    timeZone: clinic.timezone,
    now,
    minLeadMinutes: urgent ? 30 : undefined,
    partOfDay: input.franja,
    limit: 6,
    perDayPerProfessional: 2,
  });

  const names = new Map(professionals.map((p) => [p.id, p.full_name]));
  if (!slots.length) {
    return {
      ok: true,
      turnos: [],
      ...(coverageNotice && { aviso_cobertura: coverageNotice }),
      mensaje: move
        ? `No hay horarios para mover esa visita entre ${fromKey} y ${toKey}. Ofrecé buscar otras fechas. El turno original sigue reservado.`
        : urgent && span === 1
          ? "No hay lugar de urgencia hoy ni mañana. Creá una tarea de tipo «urgencia» con prioridad «urgente» para que el equipo lo contacte hoy, y decile qué hacer mientras tanto según el protocolo de urgencias."
          : next
          ? `No hay horarios entre ${fromKey} y ${toKey} en los que entren ${type.name} y ${next.name} seguidas. Ofrecé buscar más adelante o dos turnos por separado.`
          : `No hay turnos libres entre ${fromKey} y ${toKey}. Ofrecé buscar más adelante o anotar al paciente en la lista de espera.`,
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
  const extras = {
    ...(coverageNotice && { aviso_cobertura: coverageNotice }),
    ...(visit.some((t) => t.ask_before) && { preguntar_antes: visit.map((t) => t.ask_before).filter(Boolean).join(" ") }),
    ...(urgent && !move && { urgencia: true }),
  };
  if (move) {
    return {
      ok: true,
      turno_id: move.appt.id,
      tipo_turno: move.appt.title || type.name,
      ...(next && { segunda_practica: move.follower?.title || next.name }),
      duracion_min: duration,
      turnos,
      mensaje: "Ofrecé opciones para mover el turno existente. Tras la confirmación explícita, usá reprogramar_turno con este turno_id, el nuevo inicio y el profesional elegido. El turno original sigue reservado hasta que el cambio se confirma.",
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
      mensaje: `Cada horario es una sola visita con el mismo profesional: ${type.name} (${type.duration_min} min) y enseguida ${next.name} (${next.duration_min} min), hasta la hora de 'termina'. Ofrecé 2 o 3 opciones leyendo 'cuando'. Para reservar usá reservar_turno con los dos ids, y 'inicio' y 'profesional_id' tal cual.`,
    };
  }
  return {
    ok: true,
    ...extras,
    tipo_turno: type.name,
    duracion_min: type.duration_min,
    indicaciones: type.instructions,
    turnos,
    mensaje: urgent
      ? "Es un turno de urgencia: ofrecé el primero o los dos primeros, leyendo el campo 'cuando'. Para reservar usá 'inicio' y 'profesional_id' tal cual."
      : "Ofrecé 2 o 3 opciones al paciente, leyendo el campo 'cuando'. Para reservar usá 'inicio' y 'profesional_id' tal cual.",
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
              and status in ('confirmado', 'pendiente', 'atendido'))
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
    googleBusy(clinic.id, both, new Date(rangeStart), new Date(rangeEnd), { timeZone: clinic.timezone }),
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
};

const AGAIN = " Consultá la disponibilidad de nuevo y ofrecé otra opción.";

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
    // Al reservar se consulta Google en el momento, para ese horario exacto: lo que se
    // anotó recién en el calendario del profesional también cuenta.
    const calendar = await googleBusy(clinic.id, second ? [pro.id, second.id] : [pro.id], startsAt, endsAt, { fresh: true, timeZone: clinic.timezone });
    const overlapping = calendar.filter((b) => new Date(b.starts_at) < endsAt && new Date(b.ends_at) > startsAt);
    // Al paciente no se le cuenta qué tiene el profesional en su calendario; al consultorio, sí.
    if (overlapping.length) {
      const who = overlapping.some((b) => b.professional_id === pro.id) ? pro : second!;
      throw new ToolError(`Ese horario ya está ocupado.${AGAIN}`, true, `Ese horario está ocupado en el Google Calendar de ${who.full_name}.`);
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

type PatientAppointment = { id: string; starts_at: string; ends_at: string; professional_id: string; appointment_type_id: string; professional: string; type_name: string };

/** Los turnos activos que todavía no terminaron de un paciente. */
async function upcomingOf(patientId: string): Promise<PatientAppointment[]> {
  return sql<PatientAppointment[]>`
    select a.id, a.starts_at, a.ends_at, a.professional_id, a.appointment_type_id, pr.full_name || coalesce(' y ' || p2.full_name, '') as professional, coalesce(a.title, t.name) as type_name
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
> & Partial<Pick<Appointment, "second_professional_id" | "title">>;

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

export async function bookAppointment(ctx: ToolContext, input: BookInput, opts: Pick<BookOptions, "force" | "secondProfessionalId"> = {}) {
  const clinic = await getClinic(ctx.clinicId);
  const byPanel = ctx.channel === "panel";
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
  if (!same) parts.push({ ...(await assertBookable(clinic, input.profesional_id, input.tipo_turno_id, startsAt, { ...opts, byPanel })), startsAt });
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
  try {
    created = await sql.begin(async (tx) => {
      await lockProfessionals(tx, second ? [pro.id, second.id] : [pro.id]);
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
            status: "confirmado",
            source: sourceFromChannel(ctx.channel, ctx.patientPhone),
            coverage,
            notes: i === 0 ? (input.notas ?? null) : null,
            ...(i === 0 && title && { title }),
          }),
        );
      }
      return rows;
    });
  } catch (e) {
    if (isOverlapError(e)) throw new ToolError("Ese horario se acaba de ocupar. Consultá la disponibilidad de nuevo.");
    throw e;
  }

  for (const [i, p] of parts.entries()) {
    // Si el paciente estaba en lista de espera para esto, la damos por resuelta.
    await sql`
      update waitlist set status = 'resuelta'
      where patient_id = ${patient.id} and appointment_type_id = ${p.type.id} and status in ('activa', 'ofrecida')`;
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

async function getOwnAppointment(ctx: ToolContext, appointmentId: string) {
  const patient = await appointmentPatient(ctx);
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
  assertNotOver(appt);
  const notice = clinic.cancel_notice_hours;
  if (notice && Date.parse(appt.starts_at) - Date.now() < notice * 3600_000) {
    throw new ToolError(
      `Faltan menos de ${notice} ${notice === 1 ? "hora" : "horas"} para el turno: según las reglas del consultorio, la cancelación la gestiona recepción. Creá una tarea de derivacion_humana con el pedido y aclarale al paciente que el turno sigue reservado hasta que recepción le confirme.`,
    );
  }
  const follower = await followerOf(appt);
  const { when, offered } = await cancelLoaded(clinic, patient, appt, input.motivo, "paciente");
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

  const entries = await sql<Array<{ id: string; patient_id: string; professional_id: string | null; full_name: string | null; phone: string | null }>>`
    select w.id, w.patient_id, w.professional_id, p.full_name, p.phone
    from waitlist w join patients p on p.id = w.patient_id
    where w.clinic_id = ${clinic.id} and w.status = 'activa' and w.appointment_type_id = ${appt.appointment_type_id}
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
    const context = `Le escribimos para ofrecerle un turno que se liberó: ${when} (profesional_id=${appt.professional_id}, tipo_turno_id=${appt.appointment_type_id}, inicio=${appt.starts_at}). Si lo quiere, reservalo enseguida porque se ofreció a varias personas.`;
    try {
      await sendPatientMessage(clinic, {
        phone,
        templateKey: "lista_espera",
        templateName: template,
        params: [entry.full_name?.split(" ")[0] || "hola", when],
        context,
        patientId: entry.patient_id,
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
  const { type, pro, second, endsAt } = await assertBookable(clinic, professionalId, appt.appointment_type_id, startsAt, {
    ignoreAppointmentId: moving,
    force,
    secondProfessionalId: appt.second_professional_id,
    durationMin: customDuration,
    byPanel,
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

  // En una transacción: liberamos el turno viejo (puede superponerse con el
  // nuevo) y reservamos el nuevo. Si algo falla, el viejo queda como estaba.
  let newAppt: Appointment;
  let newNext: Appointment | null = null;
  try {
    [newAppt, newNext] = await sql.begin(async (tx) => {
      await lockProfessionals(tx, [appt.professional_id, pro.id, ...(second ? [second.id] : [])]);
      const ids = follower ? [appt.id, follower.id] : [appt.id];
      const freed = await tx<Appointment[]>`
        update appointments set status = 'reprogramado', cancelled_at = now()
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
      return [moved, follower && next ? await insertAppointment(tx, row(follower, next, next.startsAt)) : null] as const;
    });
  } catch (e) {
    if (isOverlapError(e)) throw new ToolError("Ese horario se acaba de ocupar. Consultá la disponibilidad de nuevo.");
    throw e;
  }
  await notifyN8n("turno.reprogramado", { clinic_id: clinic.id, before: appt, after: newAppt, patient });
  if (follower && newNext) await notifyN8n("turno.reprogramado", { clinic_id: clinic.id, before: follower, after: newNext, patient });
  for (const freed of follower ? [appt, follower] : [appt]) await offerFreedSlot(clinic, freed).catch(() => 0);
  return {
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

async function loadReschedule(ctx: ToolContext, clinic: Clinic, id: string) {
  const { patient, appt } = await getOwnAppointment(ctx, id);
  assertNotOver(appt);
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
  const r = await rescheduleLoaded(clinic, patient, appt, input, sourceFromChannel(ctx.channel, ctx.patientPhone), false, follower);
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
  const r = await rescheduleLoaded(clinic, patient, appt, input, appt.source, opts.force, undefined, true);
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
// anotar_lista_espera
// ---------------------------------------------------------------------------
export async function joinWaitlist(ctx: ToolContext, input: { tipo_turno_id: string; profesional_id?: string; preferencias?: string }) {
  const patient = await ensurePatient(ctx);
  const catalog = await getCatalog(ctx.clinicId);
  const waitType = catalog.appointmentTypes.find((t) => t.id === input.tipo_turno_id);
  if (!waitType) throw new ToolError("Tipo de turno inválido.");
  assertAgentCanBook(waitType);
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
