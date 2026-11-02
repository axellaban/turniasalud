import { cleanAreaCode, parseDate, parsePhone, readPhone } from "./patient-import";
import { normalizePhone } from "./phone";
import type { AppointmentStatus, PatientSex } from "./types";

// Lectura y limpieza de datos de Smile Connect (app.smileconnect.pro).
// Corre igual en el navegador (vista previa y extracción liviana del .zip sin subir
// cientos de megas de adjuntos ni odontogramas) y en el servidor (sincronización).

export type SmileConnectProfessional = {
  externalId: string;
  fullName: string;
  active: boolean;
  boxId: string | null;
};

export type SmileConnectPatient = {
  externalId: string;
  fullName: string | null;
  dni: string | null;
  phone: string | null;
  birthDate: string | null;
  sex: PatientSex | null;
  email: string | null;
  address: string | null;
  coverage: string | null;
  coveragePlan: string | null;
  memberNumber: string | null;
  notes: string | null;
  lastAttendedDate: string | null;
};

export type SmileConnectAppointment = {
  externalId: string;
  /** Otros IDs de Smile Connect que eran un duplicado del mismo paciente en el mismo horario. */
  mergedExternalIds: string[];
  patientExternalId: string;
  professionalExternalIds: string[];
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  rawStatus: string | null;
  explicitlyAttended: boolean;
  reminderSent: boolean;
  isFirstAppointment: boolean;
  rawNotes: string | null;
  notes: string | null;
  createdAt: string | null;
  cancelledAt: string | null;
};

export type SmileConnectBlock = {
  externalId: string;
  professionalExternalId: string | null;
  startsAt: string;
  endsAt: string;
  reason: string | null;
};

export type SmileConnectPreview = {
  professionals: SmileConnectProfessional[];
  patients: number;
  patientsWithPhone: number;
  appointmentsTotal: number;
  appointmentsFuture: number;
  appointmentsPast: number;
  appointmentsCancelled: number;
  remindersAlreadySent: number;
  duplicatesMerged: number;
  sobreturnos: number;
  blocksTotal: number;
  blocksFuture: number;
};

export type SmileConnectParsed = {
  kind: "compact";
  professionals: SmileConnectProfessional[];
  patients: SmileConnectPatient[];
  appointments: SmileConnectAppointment[];
  blocks: SmileConnectBlock[];
  windowFrom: string | null;
  windowTo: string | null;
  preview: SmileConnectPreview;
};

type RawRecord = Record<string, unknown>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAST_GRACE_MS = 24 * 3600_000;

const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const clean = (v: unknown, max = 300): string | null => {
  const s = str(v).replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
};

const validDni = (v: unknown): string | null => {
  const digits = str(v).replace(/\D/g, "");
  return digits.length >= 6 && digits.length <= 11 ? digits : null;
};

const validIso = (v: unknown): string | null => {
  const s = str(v).trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

export function parseSmileConnectSex(v: unknown): PatientSex | null {
  const s = str(v).trim().toLowerCase();
  if (/^(female|f|fem|femenino|femenina|mujer)$/.test(s)) return "femenino";
  if (/^(male|m|masc|masculino|hombre|varon|varón)$/.test(s)) return "masculino";
  if (/^(o|other|otro|otra|x|nb|no binario)$/.test(s)) return "otro";
  return null;
}

export function cleanSmileConnectCoverage(v: unknown): string | null {
  const raw = clean(v, 80);
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/\s+/g, " ");
  if (key === "osde") return "OSDE";
  if (key === "swiss medical" || key === "swissmedical") return "Swiss Medical";
  if (/^particular(es)?$/.test(key)) return "Particular";
  if (key === "galeno") return "Galeno";
  if (key === "medife" || key === "medifé") return "Medifé";
  if (key === "omint") return "Omint";
  if (key === "hospital italiano") return "Hospital Italiano";
  if (key === "hospital aleman" || key === "hospital alemán") return "Hospital Alemán";
  return raw;
}

export function parseSmileConnectPhone(
  rawPhone: unknown,
  countryCode: unknown,
  areaCode: string | null = "11",
): { phone: string | null; note: string | null } {
  const raw = clean(rawPhone, 60);
  if (!raw) return { phone: null, note: null };
  const cc = str(countryCode).trim().replace(/^\+/, "").toUpperCase();
  // Código internacional extranjero explícito (por ejemplo, "1" de EE.UU./Canadá).
  if (cc && cc !== "AR" && cc !== "54" && /^\d{1,3}$/.test(cc)) {
    const digits = raw.replace(/\D/g, "");
    const intl = normalizePhone(`+${cc}${digits}`);
    if (/^\d{8,15}$/.test(intl)) return { phone: intl, note: null };
  }
  const { phone } = readPhone(raw, areaCode);
  if (phone) return { phone, note: null };
  return { phone: null, note: `Teléfono en Smile Connect: ${raw}` };
}

function detectAreaCode(rawPhones: Array<{ phone: unknown; cc: unknown }>, fallback: string | null): string | null {
  const explicit = cleanAreaCode(fallback);
  if (explicit) return explicit;
  const parsed = rawPhones
    .filter((p) => {
      const cc = str(p.cc).trim().replace(/^\+/, "").toUpperCase();
      return !cc || cc === "AR" || cc === "54";
    })
    .map((p) => parsePhone(clean(p.phone, 60)))
    .filter((p): p is string => Boolean(p));
  const caba = parsed.filter((p) => p.startsWith("54911")).length;
  return parsed.length >= 5 && caba / parsed.length >= 0.6 ? "11" : null;
}

function numericSuffix(externalId: string): number {
  const m = /(\d+)$/.exec(externalId);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

function statusPriority(a: SmileConnectAppointment): number {
  if (a.explicitlyAttended) return 5;
  if (a.status === "ausente") return 4;
  if (a.status === "confirmado" && a.reminderSent) return 3;
  if (a.status === "confirmado") return 2;
  if (a.status === "atendido") return 1;
  return 0;
}

function formatNotes(rawNotes: string | null, boxNames: string[], isFirst: boolean): string | null {
  const parts: string[] = [];
  if (rawNotes) parts.push(rawNotes);
  else if (isFirst) parts.push("Primera vez");
  const boxLabel = boxNames.filter(Boolean).join(" / ");
  if (boxLabel && (!rawNotes || !rawNotes.toLowerCase().includes(boxLabel.toLowerCase()))) {
    parts.push(boxLabel);
  }
  return parts.length ? parts.join(" · ").slice(0, 1000) : null;
}

/**
 * Unifica turnos duplicados del MISMO paciente superpuestos en el mismo horario
 * (por ejemplo, cargados dos veces en dos consultorios para una atención conjunta),
 * conservando intactos los sobreturnos reales de pacientes distintos.
 */
export function deduplicateSmileConnectAppointments(
  items: SmileConnectAppointment[],
): { appointments: SmileConnectAppointment[]; duplicatesMerged: number } {
  const sorted = [...items].sort(
    (a, b) => a.startsAt.localeCompare(b.startsAt) || numericSuffix(a.externalId) - numericSuffix(b.externalId),
  );
  const kept: SmileConnectAppointment[] = [];
  let duplicatesMerged = 0;

  for (const item of sorted) {
    if (item.status === "cancelado") {
      kept.push(item);
      continue;
    }
    const startMs = new Date(item.startsAt).getTime();
    const endMs = new Date(item.endsAt).getTime();
    const existing = kept.find((k) => {
      if (k.status === "cancelado" || k.patientExternalId !== item.patientExternalId) return false;
      const kStart = new Date(k.startsAt).getTime();
      const kEnd = new Date(k.endsAt).getTime();
      if (startMs >= kEnd || endMs <= kStart) return false;
      const sameExactSlot = kStart === startMs && kEnd === endMs;
      const sharesPro = item.professionalExternalIds.some((id) => k.professionalExternalIds.includes(id));
      return sameExactSlot || sharesPro;
    });

    if (!existing) {
      kept.push({ ...item, mergedExternalIds: [...item.mergedExternalIds] });
      continue;
    }

    duplicatesMerged++;
    const allExternalIds = [existing.externalId, ...existing.mergedExternalIds, item.externalId, ...item.mergedExternalIds];
    allExternalIds.sort((a, b) => numericSuffix(a) - numericSuffix(b));
    existing.externalId = allExternalIds[0];
    existing.mergedExternalIds = allExternalIds.slice(1);

    for (const proId of item.professionalExternalIds) {
      if (!existing.professionalExternalIds.includes(proId) && existing.professionalExternalIds.length < 2) {
        existing.professionalExternalIds.push(proId);
      }
    }
    if (item.startsAt < existing.startsAt) existing.startsAt = item.startsAt;
    if (item.endsAt > existing.endsAt) existing.endsAt = item.endsAt;

    if (statusPriority(item) > statusPriority(existing)) {
      existing.status = item.status;
      existing.rawStatus = item.rawStatus;
      existing.explicitlyAttended = item.explicitlyAttended;
    }
    existing.reminderSent = existing.reminderSent || item.reminderSent;
    existing.isFirstAppointment = existing.isFirstAppointment || item.isFirstAppointment;

    if (item.rawNotes && (!existing.rawNotes || !existing.rawNotes.includes(item.rawNotes))) {
      existing.rawNotes = existing.rawNotes ? `${existing.rawNotes} · ${item.rawNotes}` : item.rawNotes;
    }
    if (item.notes && (!existing.notes || !existing.notes.includes(item.notes))) {
      const extraBoxes = item.notes
        .split(" · ")
        .filter((part) => !existing.notes!.split(" · ").includes(part));
      if (extraBoxes.length) existing.notes = `${existing.notes} · ${extraBoxes.join(" · ")}`.slice(0, 1000);
    } else if (!existing.notes && item.notes) {
      existing.notes = item.notes;
    }
  }

  return { appointments: kept, duplicatesMerged };
}

/** Cuenta pares/casos de sobreturnos activos futuros (pacientes distintos con el mismo profesional a la misma hora). */
export function countFutureSobreturnos(appointments: SmileConnectAppointment[], nowIso: string): number {
  const active = appointments
    .filter((a) => (a.status === "confirmado" || a.status === "pendiente") && a.endsAt > nowIso)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  let count = 0;
  for (let i = 0; i < active.length; i++) {
    const a = active[i];
    const aEnd = new Date(a.endsAt).getTime();
    const hasOverlap = active.slice(0, i).some((prev) => {
      if (prev.patientExternalId === a.patientExternalId) return false;
      const pEnd = new Date(prev.endsAt).getTime();
      const aStart = new Date(a.startsAt).getTime();
      if (aStart >= pEnd || aEnd <= new Date(prev.startsAt).getTime()) return false;
      return a.professionalExternalIds.some((id) => prev.professionalExternalIds.includes(id));
    });
    if (hasOverlap) count++;
  }
  return count;
}

function computePreview(
  professionals: SmileConnectProfessional[],
  patients: SmileConnectPatient[],
  appointments: SmileConnectAppointment[],
  blocks: SmileConnectBlock[],
  duplicatesMerged: number,
  now: Date,
): SmileConnectPreview {
  const nowIso = now.toISOString();
  const nonCancelled = appointments.filter((a) => a.status !== "cancelado");
  const future = nonCancelled.filter((a) => a.endsAt > nowIso);
  return {
    professionals,
    patients: patients.length,
    patientsWithPhone: patients.filter((p) => Boolean(p.phone)).length,
    appointmentsTotal: appointments.length,
    appointmentsFuture: future.length,
    appointmentsPast: nonCancelled.length - future.length,
    appointmentsCancelled: appointments.length - nonCancelled.length,
    remindersAlreadySent: future.filter((a) => a.reminderSent).length,
    duplicatesMerged,
    sobreturnos: countFutureSobreturnos(appointments, nowIso),
    blocksTotal: blocks.length,
    blocksFuture: blocks.filter((b) => b.endsAt > nowIso).length,
  };
}

/**
 * Convierte tanto `datos-completos.json` (exportación histórica) como la respuesta
 * en vivo del userscript (`{ metadata, appointments, events, from, to }`) en una
 * carga liviana y uniforme lista para sincronizar en Turnia.
 */
export function parseSmileConnectPayload(
  input: unknown,
  opts: { now?: Date; areaCode?: string | null } = {},
): SmileConnectParsed {
  if (!input || typeof input !== "object") throw new Error("El archivo no tiene el formato JSON de Smile Connect.");
  const root = input as RawRecord;
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();

  // Si ya viene compactado desde el navegador, solo recalcula la vista previa y valida.
  if (root.kind === "compact" && Array.isArray(root.appointments)) {
    const professionals = (Array.isArray(root.professionals) ? root.professionals : []) as SmileConnectProfessional[];
    const patients = (Array.isArray(root.patients) ? root.patients : []) as SmileConnectPatient[];
    const rawAppts = root.appointments as SmileConnectAppointment[];
    const { appointments, duplicatesMerged } = deduplicateSmileConnectAppointments(rawAppts);
    const blocks = (Array.isArray(root.blocks) ? root.blocks : []) as SmileConnectBlock[];
    const prevDuplicates = typeof (root.preview as RawRecord | undefined)?.duplicatesMerged === "number"
      ? Number((root.preview as RawRecord).duplicatesMerged)
      : 0;
    return {
      kind: "compact",
      professionals,
      patients,
      appointments,
      blocks,
      windowFrom: validIso(root.windowFrom),
      windowTo: validIso(root.windowTo),
      preview: computePreview(professionals, patients, appointments, blocks, prevDuplicates + duplicatesMerged, now),
    };
  }

  const clinica = (root.clinica ?? root.metadata ?? {}) as RawRecord;
  const rawPros = Array.isArray(clinica.professionals) ? (clinica.professionals as RawRecord[]) : [];
  const rawBoxes = Array.isArray(clinica.boxes) ? (clinica.boxes as RawRecord[]) : [];
  const rawPatients = Array.isArray(root.pacientes)
    ? (root.pacientes as RawRecord[])
    : Array.isArray(root.patients)
      ? (root.patients as RawRecord[])
      : [];
  const rawTurnos = Array.isArray(root.turnos)
    ? (root.turnos as RawRecord[])
    : Array.isArray(root.appointments)
      ? (root.appointments as RawRecord[])
      : null;
  const rawEvents = Array.isArray(root.bloqueos_agenda)
    ? (root.bloqueos_agenda as RawRecord[])
    : Array.isArray(root.events)
      ? (root.events as RawRecord[])
      : [];

  if (!rawTurnos) {
    throw new Error("No encontré turnos en el archivo. Elegí el archivo datos-completos.json o el ZIP histórico de Smile Connect.");
  }

  const boxes: Record<string, string> = {};
  for (const b of rawBoxes) {
    const id = str(b.box_id).trim();
    const name = clean(b.name, 80);
    if (id && name) boxes[id] = name;
  }

  const professionals: SmileConnectProfessional[] = rawPros
    .map((p) => {
      const externalId = str(p.professional_id ?? p.id).trim();
      const fullName = clean(`${str(p.name)} ${str(p.surname)}`, 120) ?? clean(p.full_name, 120) ?? "";
      return {
        externalId,
        fullName,
        active: p.active !== false && !p.deleted_at,
        boxId: p.box_id != null ? str(p.box_id) : null,
      };
    })
    .filter((p) => p.externalId && p.fullName);

  const phoneSamples: Array<{ phone: unknown; cc: unknown }> = [];
  for (const rp of rawPatients) {
    const ficha = (rp.ficha ?? rp) as RawRecord;
    const lista = (rp.lista ?? rp) as RawRecord;
    phoneSamples.push({ phone: ficha.phone_number ?? lista.phone_number, cc: ficha.phone_country_code ?? lista.phone_country_code });
  }
  for (const rt of rawTurnos) {
    phoneSamples.push({ phone: rt.patient_phone_number, cc: rt.patient_phone_country_code });
  }
  const areaCode = detectAreaCode(phoneSamples, opts.areaCode ?? "11");
  const todayKey = nowIso.slice(0, 10);

  const patientMap = new Map<string, SmileConnectPatient>();

  for (const rp of rawPatients) {
    const lista = (rp.lista ?? rp) as RawRecord;
    const ficha = (rp.ficha ?? rp) as RawRecord;
    const rawId = str(ficha.patient_id ?? lista.patient_id).trim();
    if (!rawId) continue;
    const externalId = `sc:${rawId}`;
    const name = clean(ficha.name ?? lista.name, 100) ?? "";
    const surname = clean(ficha.surname ?? lista.surname, 100) ?? "";
    const fullName = clean(`${name} ${surname}`, 160);
    const { phone, note } = parseSmileConnectPhone(
      ficha.phone_number ?? lista.phone_number,
      ficha.phone_country_code ?? lista.phone_country_code,
      areaCode,
    );
    const rawEmail = clean(ficha.email ?? lista.email, 120);
    const email = rawEmail && EMAIL.test(rawEmail) ? rawEmail.toLowerCase() : null;
    const birthDate = parseDate(clean(ficha.birth_day, 30), now);
    const lastVisit = parseDate(clean(lista.last_attended_date, 30), now);
    patientMap.set(externalId, {
      externalId,
      fullName,
      dni: validDni(ficha.id_number ?? lista.id_number),
      phone,
      birthDate,
      sex: parseSmileConnectSex(ficha.sex),
      email,
      address: clean(ficha.address, 200),
      coverage: cleanSmileConnectCoverage(ficha.medical_insurance_name),
      coveragePlan: clean(ficha.medical_insurance_plan, 60),
      memberNumber: clean(ficha.medical_insurance_number, 50),
      notes: note,
      lastAttendedDate: lastVisit && lastVisit <= todayKey ? lastVisit : null,
    });
  }

  const parsedAppointments: SmileConnectAppointment[] = [];

  for (const rt of rawTurnos) {
    const apptId = str(rt.appointment_id ?? rt.id).trim();
    const startsAt = validIso(rt.start_date);
    const endsAt = validIso(rt.end_date);
    if (!apptId || !startsAt || !endsAt) continue;
    const startMs = new Date(startsAt).getTime();
    const endMs = new Date(endsAt).getTime();
    if (endMs <= startMs) continue;

    const rawPatientId = str(rt.patient_id).trim();
    const patientExternalId = rawPatientId ? `sc:${rawPatientId}` : `sc:inline:${apptId}`;

    // Si el paciente no vino en `pacientes[]` (o es la sincronización en vivo del userscript),
    // armamos su ficha con los datos que trae el propio turno.
    if (!patientMap.has(patientExternalId)) {
      const fullName = clean(`${str(rt.patient_name)} ${str(rt.patient_surname)}`, 160);
      const { phone, note } = parseSmileConnectPhone(rt.patient_phone_number, rt.patient_phone_country_code, areaCode);
      const rawEmail = clean(rt.patient_email, 120);
      patientMap.set(patientExternalId, {
        externalId: patientExternalId,
        fullName,
        dni: validDni(rt.patient_id_number),
        phone,
        birthDate: null,
        sex: null,
        email: rawEmail && EMAIL.test(rawEmail) ? rawEmail.toLowerCase() : null,
        address: null,
        coverage: null,
        coveragePlan: null,
        memberNumber: null,
        notes: note,
        lastAttendedDate: null,
      });
    }

    const proList = Array.isArray(rt.professional_ids)
      ? rt.professional_ids.map((id) => str(id).trim()).filter(Boolean)
      : [];
    const fallbackPro = str(rt.professional_id).trim();
    if (!proList.length && fallbackPro) proList.push(fallbackPro);
    const uniquePros = [...new Set(proList)].slice(0, 2);
    if (!uniquePros.length) continue;

    // Si en el archivo o la respuesta en vivo no vino `clinica.professionals`, igual registramos el ID.
    for (const pid of uniquePros) {
      if (!professionals.some((p) => p.externalId === pid)) {
        professionals.push({ externalId: pid, fullName: `Profesional ${pid}`, active: true, boxId: null });
      }
    }

    const deletedAt = validIso(rt.deleted_at);
    const createdAt = validIso(rt.created_at);
    const attendedRaw = clean(rt.patient_attended ?? rt.status, 60);
    const rawStatus = deletedAt ? "Deleted" : attendedRaw;
    const reminderSent = attendedRaw === "Whatsapp Sent" || attendedRaw === "Notified";
    const isFirstAppointment = Boolean(rt.is_first_appointment);

    let status: AppointmentStatus;
    let explicitlyAttended = false;
    let cancelledAt: string | null = null;
    if (deletedAt || attendedRaw === "Canceled with Notice") {
      status = "cancelado";
      cancelledAt = deletedAt ?? createdAt ?? nowIso;
    } else if (attendedRaw === "Did not attend") {
      status = "ausente";
    } else if (attendedRaw === "Attended") {
      status = "atendido";
      explicitlyAttended = true;
    } else if (endMs <= nowMs - PAST_GRACE_MS) {
      // Turnos históricos de meses anteriores que quedaron sin tildar en Smile Connect:
      // se guardan como atendidos para no llenar la Agenda de avisos de "sin marcar".
      status = "atendido";
    } else {
      status = "confirmado";
    }

    const rawNotes = clean(rt.notes, 800);
    const boxName = rt.box_id != null ? boxes[str(rt.box_id)] : undefined;
    parsedAppointments.push({
      externalId: `sc:${apptId}`,
      mergedExternalIds: [],
      patientExternalId,
      professionalExternalIds: uniquePros,
      startsAt,
      endsAt,
      status,
      rawStatus,
      explicitlyAttended,
      reminderSent,
      isFirstAppointment,
      rawNotes,
      notes: formatNotes(rawNotes, boxName ? [boxName] : [], isFirstAppointment),
      createdAt,
      cancelledAt,
    });
  }

  const { appointments, duplicatesMerged } = deduplicateSmileConnectAppointments(parsedAppointments);

  const blocks: SmileConnectBlock[] = [];
  for (const ev of rawEvents) {
    if (ev.deleted_at) continue;
    const eventId = str(ev.event_id ?? ev.id).trim();
    const startsAt = validIso(ev.start_date);
    const rawEndsAt = validIso(ev.end_date);
    if (!eventId || !startsAt || !rawEndsAt) continue;
    const startMs = new Date(startsAt).getTime();
    let endMs = new Date(rawEndsAt).getTime();
    if (endMs <= startMs) continue;
    // Bloqueo de día completo (00:00 → 23:59:59.999): se redondea al minuto cerrado siguiente.
    if (endMs - startMs >= 23.9 * 3600_000 && endMs % 60_000 >= 59_000) {
      endMs = Math.ceil(endMs / 60_000) * 60_000;
    }
    const rawName = clean(ev.name, 120);
    const label =
      !rawName || rawName === "outOfService"
        ? ev.type === "outOfService"
          ? "Fuera de servicio"
          : "Agenda bloqueada"
        : rawName;
    const evNotes = clean(ev.notes, 200);
    const reason = [label, evNotes && evNotes.toLowerCase() !== label.toLowerCase() ? evNotes : null]
      .filter(Boolean)
      .join(" · ")
      .slice(0, 200);
    blocks.push({
      externalId: `sc:${eventId}`,
      professionalExternalId: ev.professional_id != null ? str(ev.professional_id).trim() || null : null,
      startsAt,
      endsAt: new Date(endMs).toISOString(),
      reason: reason || "Agenda bloqueada",
    });
  }

  const patients = [...patientMap.values()];
  return {
    kind: "compact",
    professionals,
    patients,
    appointments,
    blocks,
    windowFrom: validIso(root.from ?? root.windowFrom),
    windowTo: validIso(root.to ?? root.windowTo),
    preview: computePreview(professionals, patients, appointments, blocks, duplicatesMerged, now),
  };
}

/**
 * Divide una importación grande en tandas livianas (~150 KB por pedido) para que
 * pase siempre por el límite de cuerpo de Vercel y muestre el avance en pantalla.
 */
export function splitSmileConnectBatches(parsed: SmileConnectParsed, batchSize = 350): SmileConnectParsed[] {
  if (parsed.appointments.length <= batchSize) return [parsed];
  const batches: SmileConnectParsed[] = [];
  for (let i = 0; i < parsed.appointments.length; i += batchSize) {
    const first = i === 0;
    const slice = parsed.appointments.slice(i, i + batchSize);
    const neededPatients = new Set(slice.map((a) => a.patientExternalId));
    batches.push({
      kind: "compact",
      professionals: parsed.professionals,
      // La primera tanda carga todas las fichas de pacientes y todos los bloqueos;
      // las siguientes llevan solo las fichas que referencian sus turnos por si acaso.
      patients: first ? parsed.patients : parsed.patients.filter((p) => neededPatients.has(p.externalId)),
      appointments: slice,
      blocks: first ? parsed.blocks : [],
      windowFrom: null,
      windowTo: null,
      preview: parsed.preview,
    });
  }
  return batches;
}

/**
 * Lee `datos-completos.json` desde un archivo `.json` o directamente desde el
 * `.zip` histórico de Smile Connect en el navegador (o Node), sin subir el ZIP
 * entero ni descomprimir adjuntos pesados.
 */
export async function extractSmileConnectJsonText(bytes: Uint8Array): Promise<string> {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    return new TextDecoder("utf-8").decode(bytes);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minEocd = Math.max(0, bytes.length - 65557);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= minEocd; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("El archivo ZIP está incompleto o dañado.");

  const cdCount = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  let pos = cdOffset;
  let targetOffset = -1;
  let compressedSize = 0;
  let method = 0;

  for (let i = 0; i < cdCount && pos + 46 <= bytes.length; i++) {
    if (view.getUint32(pos, true) !== 0x02014b50) break;
    const m = view.getUint16(pos + 10, true);
    const compSize = view.getUint32(pos + 20, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localOffset = view.getUint32(pos + 42, true);
    const name = new TextDecoder("utf-8").decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
    if (name === "datos-completos.json" || name.endsWith("/datos-completos.json")) {
      targetOffset = localOffset;
      compressedSize = compSize;
      method = m;
      break;
    }
    pos += 46 + nameLen + extraLen + commentLen;
  }

  if (targetOffset < 0 || targetOffset + 30 > bytes.length || view.getUint32(targetOffset, true) !== 0x04034b50) {
    throw new Error("Ese ZIP no contiene datos-completos.json (¿elegiste un ZIP de adjuntos en lugar del ZIP histórico de datos?).");
  }

  const localNameLen = view.getUint16(targetOffset + 26, true);
  const localExtraLen = view.getUint16(targetOffset + 28, true);
  const dataStart = targetOffset + 30 + localNameLen + localExtraLen;
  const compressed = bytes.subarray(dataStart, dataStart + compressedSize);

  if (method === 0) return new TextDecoder("utf-8").decode(compressed);
  if (method !== 8) throw new Error(`Método de compresión ZIP no soportado (${method}). Descomprimí datos-completos.json y elegilo directo.`);
  if (typeof DecompressionStream === "undefined") {
    throw new Error("Tu navegador no soporta descomprimir ZIP acá. Descomprimí datos-completos.json y elegilo directo.");
  }

  const stream = new Blob([compressed.slice()]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return await new Response(stream).text();
}
