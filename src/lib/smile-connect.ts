import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret } from "./calendar/crypto";
import { syncCalendarLater } from "./calendar/sync";
import { json, sql, type TransactionSql } from "./db";
import {
  matchExisting,
  matchService,
  similarNames,
  type ExistingPatient,
  type ImportPatient,
} from "./patient-import";
import { namesMatch, normalizeDni } from "./patients";
import {
  parseSmileConnectPayload,
  type SmileConnectAppointment,
  type SmileConnectBlock,
  type SmileConnectParsed,
  type SmileConnectPatient,
  type SmileConnectProfessional,
} from "./smile-connect-parse";
import type { AppointmentStatus, PatientSex } from "./types";

export type SmileConnectSyncSummary = {
  patientsCreated: number;
  patientsUpdated: number;
  appointmentsCreated: number;
  appointmentsUpdated: number;
  appointmentsCancelled: number;
  blocksCreated: number;
  blocksUpdated: number;
  blocksDeleted: number;
  professionalsCreated: number;
};

export type SmileConnectStatus = {
  connected: boolean;
  tokenHint: string | null;
  lastSyncAt: string | null;
  lastSyncSummary: SmileConnectSyncSummary | null;
  syncedAppointments: number;
  syncedFutureAppointments: number;
  syncedBlocks: number;
};

const hashToken = (token: string) => createHash("sha256").update(`turnia-smile-connect:${token.trim()}`).digest("hex");

function generateToken(): string {
  return `sc_${randomBytes(24).toString("base64url")}`;
}

export async function getSmileConnectStatus(clinicId: string): Promise<SmileConnectStatus> {
  const [[conn], [counts], [blockCounts]] = await Promise.all([
    sql<Array<{ token_hint: string; last_sync_at: string | null; last_sync_summary: SmileConnectSyncSummary | null }>>`
      select token_hint, last_sync_at, last_sync_summary from smile_connect_connections where clinic_id = ${clinicId}`,
    sql<Array<{ total: number; future: number }>>`
      select count(*) filter (where external_id like 'sc:%')::int as total,
             count(*) filter (where external_id like 'sc:%' and status in ('confirmado', 'pendiente') and ends_at > now())::int as future
      from appointments where clinic_id = ${clinicId}`,
    sql<Array<{ total: number }>>`
      select count(*)::int as total from schedule_blocks where clinic_id = ${clinicId} and external_id like 'sc:%' and ends_at > now()`,
  ]);
  return {
    connected: Boolean(conn),
    tokenHint: conn?.token_hint ?? null,
    lastSyncAt: conn?.last_sync_at ?? null,
    lastSyncSummary: conn?.last_sync_summary ?? null,
    syncedAppointments: counts?.total ?? 0,
    syncedFutureAppointments: counts?.future ?? 0,
    syncedBlocks: blockCounts?.total ?? 0,
  };
}

/**
 * Devuelve la clave activa para el userscript de la clínica (o crea una si todavía
 * no tenía). Con `rotate = true` genera una nueva e invalida la anterior.
 */
export async function ensureSmileConnectToken(clinicId: string, opts: { rotate?: boolean } = {}): Promise<{ token: string; tokenHint: string }> {
  if (!opts.rotate) {
    const [existing] = await sql<Array<{ encrypted_token: string; token_hint: string }>>`
      select encrypted_token, token_hint from smile_connect_connections where clinic_id = ${clinicId}`;
    if (existing) {
      try {
        return { token: decryptSecret(existing.encrypted_token), tokenHint: existing.token_hint };
      } catch {
        // Si cambió SESSION_SECRET/GOOGLE_TOKEN_KEY, generamos una nueva abajo.
      }
    }
  }
  const token = generateToken();
  const hint = token.slice(-4);
  const encrypted = encryptSecret(token);
  const hash = hashToken(token);
  await sql`
    insert into smile_connect_connections (clinic_id, token_hash, token_hint, encrypted_token, updated_at)
    values (${clinicId}, ${hash}, ${hint}, ${encrypted}, now())
    on conflict (clinic_id) do update set
      token_hash = excluded.token_hash,
      token_hint = excluded.token_hint,
      encrypted_token = excluded.encrypted_token,
      updated_at = now()`;
  return { token, tokenHint: hint };
}

/** Valida el Bearer token del userscript y devuelve el `clinic_id` dueño de esa clave. */
export async function findClinicBySmileConnectToken(token: string | null | undefined): Promise<string | null> {
  const clean = token?.trim();
  if (!clean || clean.length < 16) return null;
  const [row] = await sql<Array<{ clinic_id: string }>>`
    select clinic_id from smile_connect_connections where token_hash = ${hashToken(clean)}`;
  return row?.clinic_id ?? null;
}

const stripHonorific = (name: string) =>
  name
    .replace(/^\s*(?:dr\.?|dra\.?|doctor|doctora|od\.?|odont[oó]log[oa]|lic\.?)\s+/i, "")
    .trim();

const normWords = (name: string) =>
  stripHonorific(name)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-zñ]+/)
    .filter((w) => w.length >= 2);

function matchProfessional<T extends { id: string; full_name: string }>(scName: string, candidates: T[]): T | null {
  const cleanSc = stripHonorific(scName);
  const direct = candidates.find((c) => namesMatch(cleanSc, stripHonorific(c.full_name)));
  if (direct) return direct;
  // Si en Turnia figura como «Dr. Mininni» (un solo apellido), alcanza si ningún otro profesional comparte ese apellido.
  const scTokens = normWords(scName);
  if (!scTokens.length) return null;
  const last = scTokens.at(-1)!;
  const bySurname = candidates.filter((c) => normWords(c.full_name).includes(last));
  return bySurname.length === 1 ? bySurname[0] : null;
}

function conflictsPerson(
  a: { dni: string | null; birth_date: string | null; sex: PatientSex | null },
  b: { dni: string | null; birth_date: string | null; sex: PatientSex | null },
): boolean {
  const da = normalizeDni(a.dni);
  const db = normalizeDni(b.dni);
  if (da && db && da !== db) return true;
  if (a.birth_date && b.birth_date && a.birth_date !== b.birth_date) return true;
  return Boolean(a.sex && b.sex && a.sex !== "otro" && b.sex !== "otro" && a.sex !== b.sex);
}

type GroupedPatient = ImportPatient & { externalIds: string[]; lastAttendedDates: string[] };

/**
 * Agrupa las fichas entrantes que corresponden a la misma persona (por ejemplo,
 * las 18 fichas duplicadas en Smile Connect), respetando familias que comparten celular.
 */
function groupIncomingPatients(patients: SmileConnectPatient[]): GroupedPatient[] {
  const groups: GroupedPatient[] = [];
  const byDni = new Map<string, GroupedPatient>();
  const byPhone = new Map<string, GroupedPatient[]>();
  const byNameNoPhone = new Map<string, GroupedPatient>();

  for (const p of patients) {
    const dni = normalizeDni(p.dni);
    const person = { dni, birth_date: p.birthDate, sex: p.sex };
    let group: GroupedPatient | undefined = dni ? byDni.get(dni) : undefined;
    if (group && conflictsPerson(group, person)) group = undefined;
    if (!group && p.phone) {
      group = (byPhone.get(p.phone) ?? []).find(
        (g) => !conflictsPerson(g, person) && (!p.fullName || !g.full_name || similarNames(g.full_name, p.fullName)),
      );
    }
    if (!group && !p.phone && p.fullName) {
      const key = normWords(p.fullName).join(" ");
      const candidate = key ? byNameNoPhone.get(key) : undefined;
      if (candidate && !conflictsPerson(candidate, person)) group = candidate;
    }

    if (!group) {
      group = {
        key: groups.length,
        lines: [groups.length + 1],
        externalIds: [],
        lastAttendedDates: [],
        phone: p.phone,
        other_phones: [],
        full_name: p.fullName,
        dni,
        email: p.email,
        birth_date: p.birthDate,
        sex: p.sex,
        address: p.address,
        coverage: p.coverage,
        coverage_plan: p.coveragePlan,
        member_number: p.memberNumber,
        notes: p.notes,
        next_control_at: null,
        next_control_reason: null,
        visits: [],
      };
      groups.push(group);
      if (dni) byDni.set(dni, group);
      if (p.phone) byPhone.set(p.phone, [...(byPhone.get(p.phone) ?? []), group]);
      else if (p.fullName) {
        const key = normWords(p.fullName).join(" ");
        if (key) byNameNoPhone.set(key, group);
      }
    } else {
      if (p.phone && !group.phone) {
        group.phone = p.phone;
        byPhone.set(p.phone, [...(byPhone.get(p.phone) ?? []), group]);
      } else if (p.phone && p.phone !== group.phone && !group.other_phones.includes(p.phone)) {
        group.other_phones.push(p.phone);
      }
      group.full_name ??= p.fullName;
      group.dni ??= dni;
      if (dni && !byDni.has(dni)) byDni.set(dni, group);
      group.email ??= p.email;
      group.birth_date ??= p.birthDate;
      group.sex ??= p.sex;
      group.address ??= p.address;
      group.coverage ??= p.coverage;
      group.coverage_plan ??= p.coveragePlan;
      group.member_number ??= p.memberNumber;
      if (p.notes && (!group.notes || !group.notes.includes(p.notes))) {
        group.notes = group.notes ? `${group.notes}\n${p.notes}`.slice(0, 2000) : p.notes;
      }
    }

    if (!group.externalIds.includes(p.externalId)) group.externalIds.push(p.externalId);
    if (p.lastAttendedDate && !group.lastAttendedDates.includes(p.lastAttendedDate)) {
      group.lastAttendedDates.push(p.lastAttendedDate);
    }
  }
  return groups;
}

async function resolveProfessionals(
  tx: TransactionSql,
  clinicId: string,
  incoming: SmileConnectProfessional[],
  defaultSpecialty: string,
): Promise<{ map: Map<string, { id: string; specialty: string }>; created: number }> {
  const existing = await tx<Array<{ id: string; full_name: string; specialty: string; active: boolean }>>`
    select id, full_name, specialty, active from professionals where clinic_id = ${clinicId} order by active desc, created_at`;
  const used = new Set<string>();
  const map = new Map<string, { id: string; specialty: string }>();
  let created = 0;

  for (const scPro of incoming) {
    const available = existing.filter((e) => !used.has(e.id));
    const found = matchProfessional(scPro.fullName, available);
    if (found) {
      used.add(found.id);
      map.set(scPro.externalId, { id: found.id, specialty: found.specialty });
      continue;
    }
    const [inserted] = await tx<Array<{ id: string; specialty: string }>>`
      insert into professionals (clinic_id, full_name, specialty, active)
      values (${clinicId}, ${scPro.fullName}, ${defaultSpecialty}, ${scPro.active})
      returning id, specialty`;
    existing.push({ id: inserted.id, full_name: scPro.fullName, specialty: inserted.specialty, active: scPro.active });
    used.add(inserted.id);
    map.set(scPro.externalId, { id: inserted.id, specialty: inserted.specialty });
    created++;
  }
  return { map, created };
}

type DbType = { id: string; name: string; specialty: string; is_first_visit: boolean; panel_only: boolean; active: boolean };

async function resolveAppointmentTypePicker(tx: TransactionSql, clinicId: string) {
  const types = [
    ...(await tx<DbType[]>`
      select id, name, specialty, is_first_visit, panel_only, active
      from appointment_types where clinic_id = ${clinicId} order by active desc, created_at`),
  ];
  const fallbackBySpecialty = new Map<string, string>();
  for (const t of types) {
    if (t.name.toLowerCase() === "turno smile connect") fallbackBySpecialty.set(t.specialty, t.id);
  }

  return async (specialty: string, isFirst: boolean, rawNotes: string | null): Promise<string> => {
    const forSpec = types.filter((t) => t.specialty === specialty && t.name.toLowerCase() !== "turno smile connect");
    if (rawNotes) {
      const matched = matchService(rawNotes, forSpec);
      if (matched) return matched.id;
    }
    if (isFirst) {
      const firstVisit = forSpec.find((t) => t.is_first_visit && t.active) ?? forSpec.find((t) => t.is_first_visit);
      if (firstVisit) return firstVisit.id;
    }
    const existingFallback = fallbackBySpecialty.get(specialty);
    if (existingFallback) return existingFallback;

    const [created] = await tx<DbType[]>`
      insert into appointment_types (clinic_id, name, specialty, duration_min, is_first_visit, panel_only, active)
      values (${clinicId}, 'Turno Smile Connect', ${specialty}, 30, false, true, true)
      returning id, name, specialty, is_first_visit, panel_only, active`;
    types.push(created);
    fallbackBySpecialty.set(specialty, created.id);
    return created.id;
  };
}

async function syncPatients(
  tx: TransactionSql,
  clinicId: string,
  incoming: SmileConnectPatient[],
  opts: { recordImport?: boolean; actor?: string },
): Promise<{ patientIdByExt: Map<string, string>; created: number; updated: number }> {
  const patientIdByExt = new Map<string, string>();
  if (!incoming.length) return { patientIdByExt, created: 0, updated: 0 };

  const extIds = incoming.map((p) => p.externalId);
  const mappedRows = await tx<Array<{ external_id: string; patient_id: string }>>`
    select external_id, patient_id from patient_external_ids
    where clinic_id = ${clinicId} and external_id = any(${extIds}::text[])`;
  for (const r of mappedRows) patientIdByExt.set(r.external_id, r.patient_id);

  const alreadyMapped: Array<{ id: string } & Omit<SmileConnectPatient, "externalId" | "lastAttendedDate">> = [];
  const unmapped: SmileConnectPatient[] = [];
  for (const p of incoming) {
    const existingId = patientIdByExt.get(p.externalId);
    if (existingId) {
      const { externalId: _ext, lastAttendedDate: _last, ...rest } = p;
      void _ext;
      void _last;
      alreadyMapped.push({ id: existingId, ...rest });
    } else {
      unmapped.push(p);
    }
  }

  let created = 0;
  let updated = 0;
  let importRecordId: string | null = null;

  if (unmapped.length) {
    const grouped = groupIncomingPatients(unmapped);
    const current = await tx<ExistingPatient[]>`
      select id, phone, full_name, dni, birth_date::text as birth_date, sex from patients where clinic_id = ${clinicId}`;
    const phoneOf = new Map(current.map((p) => [p.id, p.phone]));
    const matches = matchExisting(grouped, [...current]);

    if (opts.recordImport) {
      const [rec] = await tx<Array<{ id: string }>>`
        insert into patient_imports (clinic_id, source, actor, rows_total, skipped)
        values (${clinicId}, 'Smile Connect', ${opts.actor ?? 'Smile Connect'}, ${incoming.length}, 0)
        returning id`;
      importRecordId = rec.id;
    }

    const freshRows: Array<Record<string, unknown>> = [];
    const matchedUpdates: Array<Record<string, unknown>> = [];
    const extLinks: Array<{ clinic_id: string; external_id: string; patient_id: string }> = [];
    const phoneLinks: Array<{ clinic_id: string; phone: string; patient_id: string }> = [];

    for (let i = 0; i < grouped.length; i++) {
      const g = grouped[i];
      let targetId = matches[i];
      if (!targetId) {
        const [inserted] = await tx<Array<{ id: string }>>`
          insert into patients (
            clinic_id, import_id, full_name, phone, dni, email, birth_date, sex, address, coverage, coverage_plan, member_number, notes
          ) values (
            ${clinicId}, ${importRecordId}, ${g.full_name}, ${g.phone}, ${g.dni}, ${g.email}, ${g.birth_date}, ${g.sex},
            ${g.address}, ${g.coverage}, ${g.coverage_plan}, ${g.member_number}, ${g.notes}
          ) returning id`;
        targetId = inserted.id;
        freshRows.push(inserted);
      } else {
        matchedUpdates.push({
          id: targetId,
          full_name: g.full_name,
          phone: g.phone,
          dni: g.dni,
          email: g.email,
          birth_date: g.birth_date,
          sex: g.sex,
          address: g.address,
          coverage: g.coverage,
          coverage_plan: g.coverage_plan,
          member_number: g.member_number,
          notes: g.notes,
        });
      }

      for (const ext of g.externalIds) {
        patientIdByExt.set(ext, targetId);
        extLinks.push({ clinic_id: clinicId, external_id: ext, patient_id: targetId });
      }
      const ownPhone = matches[i] ? (phoneOf.get(matches[i]!) ?? g.phone) : g.phone;
      for (const ph of [g.phone, ...g.other_phones]) {
        if (ph && ph !== ownPhone && !phoneLinks.some((l) => l.phone === ph)) {
          phoneLinks.push({ clinic_id: clinicId, phone: ph, patient_id: targetId });
        }
      }
    }

    created = freshRows.length;
    updated = matchedUpdates.length;

    for (let i = 0; i < matchedUpdates.length; i += 400) {
      await tx`
        update patients p set
          full_name = coalesce(p.full_name, x.full_name),
          phone = coalesce(p.phone, x.phone),
          dni = coalesce(p.dni, x.dni),
          email = coalesce(p.email, x.email),
          birth_date = coalesce(p.birth_date, x.birth_date),
          sex = coalesce(p.sex, x.sex),
          address = coalesce(p.address, x.address),
          coverage = coalesce(p.coverage, x.coverage),
          coverage_plan = coalesce(p.coverage_plan, x.coverage_plan),
          member_number = coalesce(p.member_number, x.member_number),
          notes = case
            when x.notes is null or strpos(coalesce(p.notes, ''), x.notes) > 0 then p.notes
            when p.notes is null then x.notes
            else p.notes || E'\n' || x.notes end
        from json_to_recordset(${json(matchedUpdates.slice(i, i + 400))}::json) as x(
          id uuid, full_name text, phone text, dni text, email text, birth_date date, sex text,
          address text, coverage text, coverage_plan text, member_number text, notes text)
        where p.id = x.id and p.clinic_id = ${clinicId}`;
    }

    for (let i = 0; i < phoneLinks.length; i += 400) {
      await tx`insert into patient_phones ${tx(phoneLinks.slice(i, i + 400))} on conflict (clinic_id, phone) do nothing`;
    }
    for (let i = 0; i < extLinks.length; i += 400) {
      await tx`
        insert into patient_external_ids ${tx(extLinks.slice(i, i + 400))}
        on conflict (clinic_id, external_id) do update set patient_id = excluded.patient_id`;
    }
  }

  // Si una ficha ya vinculada recibe datos nuevos (por ejemplo, primero entró desde un turno en vivo
  // y después se sube la exportación histórica completa), completamos los campos vacíos sin pisar nada.
  if (alreadyMapped.length) {
    const patchesById = new Map<
      string,
      {
        id: string;
        full_name: string | null;
        phone: string | null;
        dni: string | null;
        email: string | null;
        birth_date: string | null;
        sex: PatientSex | null;
        address: string | null;
        coverage: string | null;
        coverage_plan: string | null;
        member_number: string | null;
      }
    >();
    for (const m of alreadyMapped) {
      if (!(m.fullName || m.phone || m.dni || m.email || m.birthDate || m.sex || m.address || m.coverage)) continue;
      const cur = patchesById.get(m.id);
      if (!cur) {
        patchesById.set(m.id, {
          id: m.id,
          full_name: m.fullName,
          phone: m.phone,
          dni: m.dni,
          email: m.email,
          birth_date: m.birthDate,
          sex: m.sex,
          address: m.address,
          coverage: m.coverage,
          coverage_plan: m.coveragePlan,
          member_number: m.memberNumber,
        });
      } else {
        cur.full_name ??= m.fullName;
        cur.phone ??= m.phone;
        cur.dni ??= m.dni;
        cur.email ??= m.email;
        cur.birth_date ??= m.birthDate;
        cur.sex ??= m.sex;
        cur.address ??= m.address;
        cur.coverage ??= m.coverage;
        cur.coverage_plan ??= m.coveragePlan;
        cur.member_number ??= m.memberNumber;
      }
    }
    const patches = [...patchesById.values()];
    for (let i = 0; i < patches.length; i += 400) {
      await tx`
        update patients p set
          full_name = coalesce(p.full_name, x.full_name),
          phone = coalesce(p.phone, x.phone),
          dni = coalesce(p.dni, x.dni),
          email = coalesce(p.email, x.email),
          birth_date = coalesce(p.birth_date, x.birth_date),
          sex = coalesce(p.sex, x.sex),
          address = coalesce(p.address, x.address),
          coverage = coalesce(p.coverage, x.coverage),
          coverage_plan = coalesce(p.coverage_plan, x.coverage_plan),
          member_number = coalesce(p.member_number, x.member_number)
        from json_to_recordset(${json(patches.slice(i, i + 400))}::json) as x(
          id uuid, full_name text, phone text, dni text, email text, birth_date date, sex text,
          address text, coverage text, coverage_plan text, member_number text)
        where p.id = x.id and p.clinic_id = ${clinicId}`;
    }
  }

  // Última atención registrada en la lista de Smile Connect (por si es previa al primer turno exportado).
  const visitRows: Array<{ clinic_id: string; patient_id: string; service: string; visited_at: string; import_id: string | null }> = [];
  const seenVisit = new Set<string>();
  for (const p of incoming) {
    const pid = patientIdByExt.get(p.externalId);
    if (!pid || !p.lastAttendedDate) continue;
    const key = `${pid}|${p.lastAttendedDate}`;
    if (seenVisit.has(key)) continue;
    seenVisit.add(key);
    visitRows.push({
      clinic_id: clinicId,
      patient_id: pid,
      service: "Atención en Smile Connect",
      visited_at: p.lastAttendedDate,
      import_id: importRecordId,
    });
  }
  let insertedVisits = 0;
  for (let i = 0; i < visitRows.length; i += 500) {
    const r = await tx`
      insert into patient_visits ${tx(visitRows.slice(i, i + 500))}
      on conflict (patient_id, visited_at, service) do nothing
      returning id`;
    insertedVisits += r.length;
  }

  if (importRecordId) {
    await tx`
      update patient_imports set created_patients = ${created}, updated_patients = ${updated}, visits = ${insertedVisits}
      where id = ${importRecordId}`;
  }

  return { patientIdByExt, created, updated };
}

type ExistingApptRow = {
  id: string;
  patient_id: string;
  professional_id: string;
  second_professional_id: string | null;
  appointment_type_id: string;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
  source: string;
  notes: string | null;
  reminder_sent_at: string | null;
  cancelled_at: string | null;
  external_id: string | null;
  external_status: string | null;
};

async function syncAppointments(
  tx: TransactionSql,
  clinicId: string,
  appointments: SmileConnectAppointment[],
  patientIdByExt: Map<string, string>,
  proMap: Map<string, { id: string; specialty: string }>,
  pickType: (specialty: string, isFirst: boolean, rawNotes: string | null) => Promise<string>,
  windowFrom: string | null,
  windowTo: string | null,
): Promise<{ created: number; updated: number; cancelled: number }> {
  let created = 0;
  let updated = 0;
  let cancelled = 0;
  const nowIso = new Date().toISOString();

  // Tomamos los mismos advisory locks por profesional que usa `insertAppointment`, en orden fijo.
  const proUuids = [...new Set([...proMap.values()].map((p) => p.id))].sort();
  for (const id of proUuids) {
    await tx`select pg_advisory_xact_lock(hashtextextended(${id}::text, 0))`;
  }

  const allExtIds = appointments.flatMap((a) => [a.externalId, ...a.mergedExternalIds]);
  const minStart = appointments.reduce((m, a) => (!m || a.startsAt < m ? a.startsAt : m), windowFrom ?? "");
  const maxEnd = appointments.reduce((m, a) => (!m || a.endsAt > m ? a.endsAt : m), windowTo ?? "");

  const existingRows =
    allExtIds.length || (minStart && maxEnd)
      ? await tx<ExistingApptRow[]>`
          select id, patient_id, professional_id, second_professional_id, appointment_type_id,
                 starts_at, ends_at, status, source, notes, reminder_sent_at, cancelled_at, external_id, external_status
          from appointments
          where clinic_id = ${clinicId} and (
            ${allExtIds.length ? tx`external_id = any(${allExtIds}::text[])` : tx`false`}
            ${minStart && maxEnd ? tx`or (starts_at < ${maxEnd} and ends_at > ${minStart})` : tx``}
          )`
      : [];

  const byExternalId = new Map<string, ExistingApptRow>();
  for (const r of existingRows) {
    if (r.external_id) byExternalId.set(r.external_id, r);
  }

  // Si antes se había importado alguno de los IDs duplicados que ahora quedaron unificados, se da de baja.
  const mergedDropIds = appointments
    .flatMap((a) => a.mergedExternalIds)
    .map((ext) => byExternalId.get(ext))
    .filter((r): r is ExistingApptRow => Boolean(r));
  if (mergedDropIds.length) {
    const ids = mergedDropIds.map((r) => r.id);
    await tx`
      update appointments set status = 'cancelado', cancelled_at = coalesce(cancelled_at, now()), external_id = null
      where clinic_id = ${clinicId} and id = any(${ids}::uuid[])`;
    for (const r of mergedDropIds) if (r.external_id) byExternalId.delete(r.external_id);
  }

  const adoptedNativeIds = new Set<string>();

  for (const a of appointments) {
    const patientId = patientIdByExt.get(a.patientExternalId);
    const primaryPro = proMap.get(a.professionalExternalIds[0]);
    if (!patientId || !primaryPro) continue;
    const secondProRaw = a.professionalExternalIds[1] ? proMap.get(a.professionalExternalIds[1]) : undefined;
    const secondProId = secondProRaw && secondProRaw.id !== primaryPro.id ? secondProRaw.id : null;
    const typeId = await pickType(primaryPro.specialty, a.isFirstAppointment, a.rawNotes);

    const existing = byExternalId.get(a.externalId);
    if (existing) {
      const sameTimes =
        new Date(existing.starts_at).getTime() === new Date(a.startsAt).getTime() &&
        new Date(existing.ends_at).getTime() === new Date(a.endsAt).getTime();
      const sameExternalStatus = (existing.external_status ?? "") === (a.rawStatus ?? "");

      // Si el paciente o el consultorio canceló/reprogramó el turno en Turnia (por ejemplo, por WhatsApp con Sofi)
      // y en Smile Connect sigue sin cambios, respetamos la baja hecha en Turnia.
      if (
        (existing.status === "cancelado" || existing.status === "reprogramado") &&
        a.status !== "cancelado" &&
        sameTimes &&
        sameExternalStatus
      ) {
        continue;
      }

      // Si en el panel de Turnia ya lo marcaron como atendido o ausente y en Smile Connect sigue sin marcar, se conserva.
      const nextStatus: AppointmentStatus =
        (existing.status === "atendido" || existing.status === "ausente") &&
        a.status === "confirmado" &&
        !a.explicitlyAttended
          ? existing.status
          : a.status;

      const nextReminder = existing.reminder_sent_at ?? (a.reminderSent ? a.createdAt ?? nowIso : null);
      const nextCancelled = nextStatus === "cancelado" ? existing.cancelled_at ?? a.cancelledAt ?? nowIso : existing.cancelled_at;
      const nextNotes = a.notes ?? existing.notes;

      const changed =
        !sameTimes ||
        existing.professional_id !== primaryPro.id ||
        existing.second_professional_id !== secondProId ||
        existing.status !== nextStatus ||
        !sameExternalStatus ||
        (existing.notes ?? null) !== (nextNotes ?? null) ||
        Boolean(existing.reminder_sent_at) !== Boolean(nextReminder);

      if (changed) {
        await tx`
          update appointments set
            patient_id = ${patientId},
            professional_id = ${primaryPro.id},
            second_professional_id = ${secondProId},
            starts_at = ${a.startsAt},
            ends_at = ${a.endsAt},
            status = ${nextStatus},
            external_status = ${a.rawStatus},
            notes = ${nextNotes},
            reminder_sent_at = ${nextReminder},
            cancelled_at = ${nextCancelled}
          where id = ${existing.id} and clinic_id = ${clinicId}`;
        updated++;
      }
      continue;
    }

    // Si este mismo paciente ya tiene un turno activo en ese horario cargado en Turnia (por ejemplo,
    // lo dio Sofi por WhatsApp y recepción lo copió en Smile Connect), lo vinculamos en vez de duplicarlo.
    if (a.status !== "cancelado") {
      const aStart = new Date(a.startsAt).getTime();
      const aEnd = new Date(a.endsAt).getTime();
      const nativeMatch = existingRows.find(
        (r) =>
          !r.external_id &&
          !adoptedNativeIds.has(r.id) &&
          r.patient_id === patientId &&
          r.professional_id === primaryPro.id &&
          (r.status === "confirmado" || r.status === "pendiente") &&
          new Date(r.starts_at).getTime() < aEnd &&
          new Date(r.ends_at).getTime() > aStart,
      );
      if (nativeMatch) {
        adoptedNativeIds.add(nativeMatch.id);
        await tx`
          update appointments set
            external_id = ${a.externalId},
            external_status = ${a.rawStatus},
            reminder_sent_at = coalesce(reminder_sent_at, ${a.reminderSent ? a.createdAt ?? nowIso : null})
          where id = ${nativeMatch.id} and clinic_id = ${clinicId}`;
        updated++;
        continue;
      }
    }

    await tx`
      insert into appointments (
        clinic_id, patient_id, professional_id, second_professional_id, appointment_type_id,
        starts_at, ends_at, status, source, notes, reminder_sent_at, cancelled_at, external_id, external_status, created_at
      ) values (
        ${clinicId}, ${patientId}, ${primaryPro.id}, ${secondProId}, ${typeId},
        ${a.startsAt}, ${a.endsAt}, ${a.status}, 'smile_connect', ${a.notes},
        ${a.reminderSent ? a.createdAt ?? nowIso : null}, ${a.cancelledAt},
        ${a.externalId}, ${a.rawStatus}, ${a.createdAt ?? nowIso}
      )`;
    created++;
  }

  // En una ventana en vivo [windowFrom, windowTo), los turnos de Smile Connect que desaparecieron
  // de la respuesta (porque se borraron en Smile Connect) pasan a cancelados en Turnia.
  if (windowFrom && windowTo) {
    const seenExt = new Set(appointments.map((a) => a.externalId));
    const missingIds = existingRows
      .filter(
        (r) =>
          r.source === "smile_connect" &&
          r.external_id?.startsWith("sc:") &&
          !seenExt.has(r.external_id) &&
          (r.status === "confirmado" || r.status === "pendiente") &&
          new Date(r.starts_at).getTime() >= new Date(windowFrom).getTime() &&
          new Date(r.starts_at).getTime() < new Date(windowTo).getTime(),
      )
      .map((r) => r.id);
    if (missingIds.length) {
      const done = await tx`
        update appointments set status = 'cancelado', cancelled_at = now(), external_status = 'Deleted'
        where clinic_id = ${clinicId} and id = any(${missingIds}::uuid[])
        returning id`;
      cancelled += done.length;
    }
  }

  return { created, updated, cancelled };
}

async function syncBlocks(
  tx: TransactionSql,
  clinicId: string,
  blocks: SmileConnectBlock[],
  proMap: Map<string, { id: string; specialty: string }>,
  windowFrom: string | null,
  windowTo: string | null,
): Promise<{ created: number; updated: number; deleted: number }> {
  let created = 0;
  let updated = 0;
  let deleted = 0;

  const extIds = blocks.map((b) => b.externalId);
  const existing =
    extIds.length || (windowFrom && windowTo)
      ? await tx<Array<{ id: string; professional_id: string | null; starts_at: string; ends_at: string; reason: string | null; external_id: string | null }>>`
          select id, professional_id, starts_at, ends_at, reason, external_id
          from schedule_blocks
          where clinic_id = ${clinicId} and external_id like 'sc:%' and (
            ${extIds.length ? tx`external_id = any(${extIds}::text[])` : tx`false`}
            ${windowFrom && windowTo ? tx`or (starts_at >= ${windowFrom} and starts_at < ${windowTo})` : tx``}
          )`
      : [];

  const byExt = new Map(existing.filter((e) => e.external_id).map((e) => [e.external_id!, e]));

  for (const b of blocks) {
    const proId = b.professionalExternalId ? (proMap.get(b.professionalExternalId)?.id ?? null) : null;
    const prev = byExt.get(b.externalId);
    if (!prev) {
      await tx`
        insert into schedule_blocks (clinic_id, professional_id, starts_at, ends_at, reason, external_id)
        values (${clinicId}, ${proId}, ${b.startsAt}, ${b.endsAt}, ${b.reason}, ${b.externalId})`;
      created++;
      continue;
    }
    const changed =
      prev.professional_id !== proId ||
      new Date(prev.starts_at).getTime() !== new Date(b.startsAt).getTime() ||
      new Date(prev.ends_at).getTime() !== new Date(b.endsAt).getTime() ||
      (prev.reason ?? null) !== (b.reason ?? null);
    if (changed) {
      await tx`
        update schedule_blocks set
          professional_id = ${proId},
          starts_at = ${b.startsAt},
          ends_at = ${b.endsAt},
          reason = ${b.reason}
        where id = ${prev.id} and clinic_id = ${clinicId}`;
      updated++;
    }
  }

  if (windowFrom && windowTo) {
    const seen = new Set(extIds);
    const toDelete = existing
      .filter(
        (e) =>
          e.external_id &&
          !seen.has(e.external_id) &&
          new Date(e.starts_at).getTime() >= new Date(windowFrom).getTime() &&
          new Date(e.starts_at).getTime() < new Date(windowTo).getTime(),
      )
      .map((e) => e.id);
    if (toDelete.length) {
      const removed = await tx`delete from schedule_blocks where clinic_id = ${clinicId} and id = any(${toDelete}::uuid[]) returning id`;
      deleted += removed.length;
    }
  }

  return { created, updated, deleted };
}

/**
 * Sincroniza pacientes, turnos y bloqueos de Smile Connect en la clínica indicada,
 * sin pisar nunca los horarios semanales (`schedules`) ni disparar webhooks masivos.
 */
export async function syncSmileConnect(
  clinicId: string,
  rawInput: unknown,
  opts: { mode?: "import" | "live"; actor?: string; recordImport?: boolean; now?: Date } = {},
): Promise<{ summary: SmileConnectSyncSummary; parsed: SmileConnectParsed }> {
  const parsed = parseSmileConnectPayload(rawInput, { now: opts.now });

  const summary = await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${`smile-connect:${clinicId}`}, 0))`;

    const [defaultSpecRow] = await tx<Array<{ specialty: string }>>`
      select specialty from (
        select specialty, 1 as ord from professionals where clinic_id = ${clinicId} and active
        union all
        select specialty, 2 as ord from appointment_types where clinic_id = ${clinicId} and active
      ) s
      group by specialty
      order by min(ord), count(*) desc
      limit 1`;
    const defaultSpecialty = defaultSpecRow?.specialty || "Odontología general";

    const pros = await resolveProfessionals(tx, clinicId, parsed.professionals, defaultSpecialty);
    const pickType = await resolveAppointmentTypePicker(tx, clinicId);
    const patients = await syncPatients(tx, clinicId, parsed.patients, {
      recordImport: opts.recordImport ?? (opts.mode === "import" && parsed.patients.length > 0),
      actor: opts.actor,
    });
    const appts = await syncAppointments(
      tx,
      clinicId,
      parsed.appointments,
      patients.patientIdByExt,
      pros.map,
      pickType,
      parsed.windowFrom,
      parsed.windowTo,
    );
    const blocks = await syncBlocks(tx, clinicId, parsed.blocks, pros.map, parsed.windowFrom, parsed.windowTo);

    const result: SmileConnectSyncSummary = {
      patientsCreated: patients.created,
      patientsUpdated: patients.updated,
      appointmentsCreated: appts.created,
      appointmentsUpdated: appts.updated,
      appointmentsCancelled: appts.cancelled,
      blocksCreated: blocks.created,
      blocksUpdated: blocks.updated,
      blocksDeleted: blocks.deleted,
      professionalsCreated: pros.created,
    };

    await tx`
      update smile_connect_connections
      set last_sync_at = now(), last_sync_summary = ${json(result)}, updated_at = now()
      where clinic_id = ${clinicId}`;

    return result;
  });

  if (summary.appointmentsCreated > 0 || summary.appointmentsUpdated > 0 || summary.appointmentsCancelled > 0) {
    syncCalendarLater(clinicId);
  }

  return { summary, parsed };
}

/**
 * Genera el userscript de Tampermonkey listo para instalar en el navegador donde
 * recepción usa `https://app.smileconnect.pro/*`.
 */
export function buildSmileConnectUserscript(opts: {
  endpointUrl: string;
  secret: string;
  clinicName?: string;
}): string {
  let connectHost = "localhost";
  try {
    connectHost = new URL(opts.endpointUrl).hostname;
  } catch {
    // Si endpointUrl es una plantilla sin configurar todavía, dejamos el comodín local.
  }
  const label = opts.clinicName ? ` (${opts.clinicName.replace(/[\r\n]+/g, " ").trim()})` : "";
  const extraConnect =
    connectHost === "localhost" || connectHost === "127.0.0.1"
      ? ""
      : "\n// @connect      localhost";

  return `// ==UserScript==
// @name         Smile Connect → Turnia Salud${label}
// @namespace    turnia-salud
// @version      2.0
// @description  Mantiene los turnos, pacientes y bloqueos de Smile Connect sincronizados en tiempo real con la Agenda de Turnia Salud.
// @match        https://app.smileconnect.pro/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      ${connectHost}${extraConnect}
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  // ── Configuración ─────────────────────────────────────────────────────
  const TURNIA_SYNC_URL = ${JSON.stringify(opts.endpointUrl)};
  const SECRET = ${JSON.stringify(opts.secret)};
  const CADA_MINUTOS = 10;          // cada cuánto se actualiza mientras Smile Connect está abierto
  const DIAS_ATRAS = 14;            // revisa 2 semanas hacia atrás (asistencia/cancelaciones)...
  const DIAS_ADELANTE = 120;        // ...y 4 meses hacia adelante
  const HISTORICO_DESDE = '2026-02-01';
  // ──────────────────────────────────────────────────────────────────────

  const SC = {};

  const ymd = d => \`\${d.getFullYear()}-\${String(d.getMonth() + 1).padStart(2, '0')}-\${String(d.getDate()).padStart(2, '0')}\`;
  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function api(path) {
    const res = await fetch(location.origin + path, { credentials: 'include', headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(\`Smile Connect respondió \${res.status} en \${path.split('?')[0]}\`);
    return res.json();
  }

  async function loadMeta() {
    const m = await api('/api/clinic/metadata');
    return {
      professionals: (m.professionals || []).map(p => ({
        professional_id: p.professional_id,
        name: p.name,
        surname: p.surname,
        active: p.active,
        box_id: p.box_id,
      })),
      boxes: (m.boxes || []).map(b => ({ box_id: b.box_id, name: b.name })),
    };
  }

  function compactAppointment(a) {
    return {
      appointment_id: a.appointment_id,
      start_date: a.start_date,
      end_date: a.end_date,
      patient_id: a.patient_id,
      professional_id: a.professional_id,
      professional_ids: a.professional_ids,
      notes: a.notes,
      created_at: a.created_at,
      deleted_at: a.deleted_at,
      patient_attended: a.patient_attended,
      box_id: a.box_id,
      is_first_appointment: a.is_first_appointment,
      patient_name: a.patient_name,
      patient_surname: a.patient_surname,
      patient_id_number: a.patient_id_number,
      patient_phone_country_code: a.patient_phone_country_code,
      patient_phone_number: a.patient_phone_number,
      patient_email: a.patient_email,
    };
  }

  function compactEvent(e) {
    return {
      event_id: e.event_id,
      name: e.name,
      type: e.type,
      start_date: e.start_date,
      end_date: e.end_date,
      professional_id: e.professional_id,
      box_id: e.box_id,
      notes: e.notes,
      deleted_at: e.deleted_at,
    };
  }

  async function fetchWindow(from, to) {
    const q = \`startDate=\${ymd(addDays(from, -1))}&endDate=\${ymd(addDays(to, 1))}\`;
    const [ap, ev] = await Promise.all([api(\`/api/appointments?\${q}\`), api(\`/api/events?\${q}\`)]);
    const inRange = iso => {
      const t = new Date(iso).getTime();
      return t >= from.getTime() && t < to.getTime();
    };
    return {
      appointments: (ap.appointments || []).filter(a => inRange(a.start_date)).map(compactAppointment),
      events: (ev.events || []).filter(e => inRange(e.start_date)).map(compactEvent),
    };
  }
  Object.assign(SC, { loadMeta, fetchWindow });

  function postToTurnia(payload) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url: TURNIA_SYNC_URL,
        data: JSON.stringify(payload),
        headers: {
          'Content-Type': 'application/json;charset=utf-8',
          'Authorization': 'Bearer ' + SECRET,
        },
        timeout: 120000,
        onload: r => {
          try {
            const data = JSON.parse(r.responseText);
            if (r.status === 401 || r.status === 403) reject(new Error(data.error || 'Clave secreta inválida en Turnia'));
            else if (r.status >= 400) reject(new Error(data.error || \`Turnia respondió \${r.status}\`));
            else resolve(data);
          } catch {
            reject(new Error('Respuesta inválida de Turnia (¿URL correcta?)'));
          }
        },
        onerror: () => reject(new Error('No se pudo conectar con Turnia')),
        ontimeout: () => reject(new Error('Turnia tardó demasiado en responder')),
      });
    });
  }

  async function syncRange(from, to, metadata) {
    const { appointments, events } = await fetchWindow(from, to);
    for (let intento = 1; intento <= 3; intento++) {
      try {
        const r = await postToTurnia({
          from: from.toISOString(),
          to: to.toISOString(),
          metadata,
          appointments,
          events,
        });
        if (r && r.ok) return r.summary || {};
      } catch (e) {
        if (intento === 3 || /Clave secreta/i.test(e.message)) throw e;
      }
      await sleep(3000 * intento);
    }
    throw new Error('No terminó después de varios intentos');
  }

  const LOCK_MS = 3 * 60000;
  function tomarTurno() {
    const l = GM_getValue('turnia_sc_lock', 0);
    if (Date.now() - l < LOCK_MS) return false;
    GM_setValue('turnia_sc_lock', Date.now());
    return true;
  }
  const renovarTurno = () => GM_setValue('turnia_sc_lock', Date.now());
  const soltarTurno = () => GM_setValue('turnia_sc_lock', 0);

  let badge;
  function estado(texto, error) {
    if (!badge) {
      badge = document.createElement('div');
      badge.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:99999;font:12px/1.4 system-ui,sans-serif;padding:4px 8px;border-radius:6px;background:rgba(0,0,0,.65);color:#fff;pointer-events:none;opacity:.85';
      document.body.appendChild(badge);
    }
    badge.textContent = '📅 ' + texto;
    badge.style.background = error ? 'rgba(180,30,30,.85)' : 'rgba(0,0,0,.65)';
  }

  async function sincronizar({ forzar = false, historico = false } = {}) {
    if (TURNIA_SYNC_URL.startsWith('PEGAR') || SECRET.startsWith('PEGAR')) {
      estado('Falta configurar la URL y la clave de Turnia', true);
      return;
    }
    const ultima = GM_getValue('turnia_sc_last_ok', 0);
    const tocaHistorico = historico || !GM_getValue('turnia_sc_hist_done', false);
    if (!forzar && !tocaHistorico && Date.now() - ultima < CADA_MINUTOS * 60000) return;
    if (!tomarTurno()) return;
    try {
      const metadata = await loadMeta();
      const hoy0 = startOfDay(new Date());
      const tot = { created: 0, updated: 0, cancelled: 0 };
      const sumar = s => {
        tot.created += (s.appointmentsCreated || 0) + (s.blocksCreated || 0);
        tot.updated += (s.appointmentsUpdated || 0) + (s.blocksUpdated || 0);
        tot.cancelled += (s.appointmentsCancelled || 0) + (s.blocksDeleted || 0);
      };

      if (tocaHistorico) {
        const fin = addDays(hoy0, DIAS_ADELANTE);
        const [y, m] = HISTORICO_DESDE.split('-').map(Number);
        let ini = new Date(y, m - 1, 1);
        while (ini < fin) {
          const sig = new Date(ini.getFullYear(), ini.getMonth() + 1, 1);
          estado(\`Turnia: sincronizando \${ini.toLocaleDateString('es-AR', { month: 'short', year: 'numeric' })}…\`);
          sumar(await syncRange(ini, sig, metadata));
          renovarTurno();
          ini = sig;
        }
        GM_setValue('turnia_sc_hist_done', true);
      } else {
        estado('Sincronizando con Turnia…');
        sumar(await syncRange(addDays(hoy0, -DIAS_ATRAS), addDays(hoy0, DIAS_ADELANTE), metadata));
      }

      GM_setValue('turnia_sc_last_ok', Date.now());
      const hora = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
      const cambios = tot.created + tot.updated + tot.cancelled;
      estado(\`Turnia al día · \${hora}\${cambios ? \` (\${tot.created} nuevos, \${tot.updated} cambios, \${tot.cancelled} bajas)\` : ''}\`);
      console.info('[Smile Connect → Turnia Salud]', tot);
    } catch (e) {
      // Si el usuario aún no inició sesión en Smile Connect (401), esperamos en silencio al próximo ciclo.
      if (/respondió 401/.test(e.message)) return;
      estado('Turnia: ' + e.message, true);
      console.error('[Smile Connect → Turnia Salud]', e);
    } finally {
      soltarTurno();
    }
  }

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Sincronizar con Turnia ahora', () => sincronizar({ forzar: true }));
    GM_registerMenuCommand('Sincronizar histórico completo con Turnia', () => sincronizar({ forzar: true, historico: true }));
  }
  if (typeof unsafeWindow !== 'undefined') unsafeWindow.__turniaSmileSync = SC;
  if (typeof GM_xmlhttpRequest === 'function') {
    setTimeout(() => sincronizar(), 10000);
    setInterval(() => sincronizar(), 60000);
  } else {
    window.__turniaSmileSync = SC;
  }
})();
`;
}
