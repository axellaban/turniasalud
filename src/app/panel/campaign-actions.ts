"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { json, sql } from "@/lib/db";
import { isUuid } from "@/lib/clinic";
import { markManualSent, prepareCampaign, sendCampaign, setRecipientIncluded, syncAudience } from "@/lib/campaigns";
import { getPanelClinic, logClinicChange, requirePanelSession, touchClinic } from "@/lib/panel-clinic";
import { randomUUID } from "node:crypto";
import {
  IMPORT_FIELDS,
  buildImport,
  detectMapping,
  matchExisting,
  matchService,
  parseTable,
  type ColumnMapping,
  type ExistingPatient,
  type ImportField,
  type ImportPatient,
} from "@/lib/patient-import";
import { parseDateKey } from "@/lib/time";
import { CAMPAIGN_TYPES, type CampaignType } from "@/lib/types";

// Campañas y base de pacientes: preparar, revisar y enviar campañas; frecuencia de controles,
// reglas de contacto e importación de pacientes desde el sistema anterior de la clínica.

const text = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

const uuid = (form: FormData, key: string) => {
  const value = text(form, key);
  return isUuid(value) ? value : null;
};

export type CampaignFormState = { ok?: boolean; message?: string };

const refresh = (id?: string) => {
  revalidatePath("/panel/campanas");
  if (id) revalidatePath(`/panel/campanas/${id}`);
};

/** Arma la campaña con su lista para revisar (o sigue la que ya estaba sin terminar). */
export async function prepareCampaignAction(form: FormData) {
  await requirePanelSession();
  const clinic = await getPanelClinic(form);
  const type = text(form, "type") as CampaignType | null;
  if (!type || !CAMPAIGN_TYPES.includes(type)) return;
  const campaign = await prepareCampaign(clinic, {
    type,
    name: text(form, "name"),
    goal: text(form, "goal"),
    templateName: text(form, "template_name"),
  });
  refresh(campaign.id);
  redirect(`/panel/campanas/${campaign.id}`);
}

export async function sendCampaignAction(_prev: CampaignFormState | undefined, form: FormData): Promise<CampaignFormState> {
  await requirePanelSession();
  const id = uuid(form, "id");
  if (!id) return { ok: false, message: "Falta la campaña." };
  const clinic = await getPanelClinic(form);
  if (clinic.is_demo) return { ok: false, message: "Los perfiles de demo no envían campañas." };
  if (!(await sql`select id from campaigns where id = ${id} and clinic_id = ${clinic.id}`).length) return { ok: false, message: "La campaña no pertenece a esta clínica." };
  try {
    const r = await sendCampaign(id);
    refresh(id);
    const parts = [`Enviamos ${r.sent} ${r.sent === 1 ? "mensaje" : "mensajes"}.`];
    if (r.remaining) parts.push(`Quedan ${r.remaining}: volvé a tocar «Enviar» para seguir.`);
    if (r.skipped) parts.push(`${r.skipped} ya no correspondían y quedaron afuera.`);
    if (r.failed) parts.push(`${r.failed} con error: ${r.errors.slice(0, 3).join(" · ")}`);
    return { ok: r.failed === 0, message: parts.join(" ") };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Vuelve a calcular la lista: suma a quienes ahora cumplen y saca a los que ya no. */
export async function refreshAudienceAction(form: FormData) {
  await requirePanelSession();
  const id = uuid(form, "id");
  const clinic = await getPanelClinic(form);
  if (!id || !(await sql`select id from campaigns where id = ${id} and clinic_id = ${clinic.id}`).length) return;
  await syncAudience(id);
  refresh(id);
}

export async function toggleRecipientAction(form: FormData) {
  await requirePanelSession();
  const id = uuid(form, "id");
  const campaignId = uuid(form, "campaign_id");
  if (!id) return;
  const clinic = await getPanelClinic(form);
  await setRecipientIncluded(clinic.id, id, form.get("include") === "true");
  refresh(campaignId ?? undefined);
}

/** El equipo abrió el chat desde el panel para mandarlo desde su WhatsApp. */
export async function markManualSentAction(form: FormData) {
  await requirePanelSession();
  const id = uuid(form, "id");
  if (!id) return;
  const clinic = await getPanelClinic(form);
  const campaignId = await markManualSent(clinic.id, id);
  if (campaignId) refresh(campaignId);
}

/** Mensaje propio de la campaña ({nombre} y {detalle}); vacío vuelve al sugerido. */
export async function saveCampaignMessageAction(_prev: CampaignFormState | undefined, form: FormData): Promise<CampaignFormState> {
  await requirePanelSession();
  const clinic = await getPanelClinic(form);
  const id = uuid(form, "id");
  if (!id) return { ok: false, message: "Falta la campaña." };
  const message = text(form, "message");
  if (message && message.length > 900) return { ok: false, message: "El mensaje es muy largo: dejalo en menos de 900 caracteres." };
  const rows = await sql`update campaigns set message = ${message}, goal = coalesce(${text(form, "goal")}, goal) where id = ${id} and clinic_id = ${clinic.id} returning id`;
  if (!rows.length) return { ok: false, message: "La campaña no es de esta clínica." };
  refresh(id);
  return { ok: true, message: message ? "Mensaje guardado." : "Volvimos al mensaje sugerido." };
}

/** Descarta un borrador que todavía no le escribió a nadie. */
export async function discardCampaignAction(form: FormData) {
  await requirePanelSession();
  const id = uuid(form, "id");
  const clinic = await getPanelClinic(form);
  if (!id) return;
  await sql`
    delete from campaigns c where c.id = ${id} and c.clinic_id = ${clinic.id} and c.status = 'borrador'
      and not exists (select 1 from campaign_recipients r where r.campaign_id = c.id and r.sent_at is not null)`;
  refresh();
  redirect("/panel/campanas");
}

// ---------------------------------------------------------------------------
// Controles periódicos y reglas de contacto
// ---------------------------------------------------------------------------
export async function setRecallMonthsAction(_prev: CampaignFormState | undefined, form: FormData): Promise<CampaignFormState> {
  await requirePanelSession();
  const clinic = await getPanelClinic(form);
  const id = uuid(form, "id");
  const raw = text(form, "recall_months");
  const months = raw ? Number(raw) : null;
  if (!id) return { ok: false, message: "No encontré la prestación." };
  if (months !== null && (!Number.isInteger(months) || months < 1 || months > 60)) return { ok: false, message: "Elegí entre 1 y 60 meses." };
  const rows = await sql`update appointment_types set recall_months = ${months} where id = ${id} and clinic_id = ${clinic.id} returning id`;
  if (!rows.length) return { ok: false, message: "La prestación no es de esta clínica. Recargá la página." };
  await touchClinic(clinic.id, "Prestaciones");
  refresh();
  revalidatePath("/panel/configuracion", "layout");
  return { ok: true, message: months ? `Control cada ${months} ${months === 1 ? "mes" : "meses"}.` : "Sin control periódico." };
}

export async function saveContactRulesAction(_prev: CampaignFormState | undefined, form: FormData): Promise<CampaignFormState> {
  await requirePanelSession();
  const clinic = await getPanelClinic(form);
  const reactivation = Number(text(form, "reactivation_months"));
  const cooldown = Number(text(form, "contact_cooldown_days"));
  if (!Number.isInteger(reactivation) || reactivation < 3 || reactivation > 60) return { ok: false, message: "La inactividad va de 3 a 60 meses." };
  if (!Number.isInteger(cooldown) || cooldown < 0 || cooldown > 365) return { ok: false, message: "El tope va de 0 a 365 días." };
  await sql`update clinics set reactivation_months = ${reactivation}, contact_cooldown_days = ${cooldown} where id = ${clinic.id}`;
  await logClinicChange(clinic.id, "Reglas de campañas");
  refresh();
  return { ok: true, message: "Reglas guardadas." };
}

/** Control indicado para un paciente puntual: entra en el recall cuando llega la fecha. */
export async function setNextControlAction(_prev: CampaignFormState | undefined, form: FormData): Promise<CampaignFormState> {
  await requirePanelSession();
  const clinic = await getPanelClinic(form);
  const id = uuid(form, "id");
  if (!id) return { ok: false, message: "No encontré al paciente." };
  const raw = text(form, "next_control_at");
  const date = parseDateKey(raw);
  if (raw && !date) return { ok: false, message: "Revisá la fecha." };
  const reason = text(form, "next_control_reason")?.slice(0, 120) ?? null;
  const rows = await sql`
    update patients set next_control_at = ${date}, next_control_reason = ${date ? reason : null}
    where id = ${id} and clinic_id = ${clinic.id} returning id`;
  if (!rows.length) return { ok: false, message: "El paciente no es de esta clínica." };
  revalidatePath(`/panel/pacientes/${id}`);
  refresh();
  return { ok: true, message: date ? "Control agendado: Sofi le escribe cuando llegue la fecha." : "Control quitado." };
}

// ---------------------------------------------------------------------------
// Importar pacientes (Excel o CSV del sistema anterior)
// ---------------------------------------------------------------------------
export type ImportState = {
  ok?: boolean;
  message?: string;
  summary?: {
    created: number;
    existing: number;
    visits: number;
    skipped: number;
    /** Fichas sin celular que sirva para WhatsApp. */
    withoutPhone: number;
    /** Celulares que quedaron con más de una ficha (familias). */
    sharedPhones: number;
    unmatched: string[];
  };
};

/** Lo que manda el formulario sobre a quién se junta cada fila de un celular compartido. */
function postedSameAs(form: FormData): Record<number, number> | undefined {
  try {
    const posted = JSON.parse(String(form.get("same_as") ?? "null")) as unknown;
    if (!posted || typeof posted !== "object" || Array.isArray(posted)) return undefined;
    const entries = Object.entries(posted).filter(([line, target]) => /^\d+$/.test(line) && Number.isInteger(target) && (target as number) >= 0);
    return Object.fromEntries(entries.map(([line, target]) => [Number(line), target as number]));
  } catch {
    return undefined;
  }
}

export async function importPatientsAction(_prev: ImportState | undefined, form: FormData): Promise<ImportState> {
  const user = await requirePanelSession();
  const clinic = await getPanelClinic(form);
  const raw = form.get("text");
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, message: "Pegá la planilla o elegí un archivo." };
  if (form.get("consent") !== "on") return { ok: false, message: "Confirmá que son pacientes de la clínica y que pueden recibir sus mensajes." };

  const table = parseTable(raw);
  let mapping: ColumnMapping;
  try {
    const posted = JSON.parse(String(form.get("mapping") ?? "null")) as unknown;
    const valid = Array.isArray(posted) && posted.length === table.headers.length && posted.every((f) => f === null || IMPORT_FIELDS.includes(f as ImportField));
    mapping = valid ? (posted as ColumnMapping) : detectMapping(table.headers);
  } catch {
    mapping = detectMapping(table.headers);
  }
  if (!mapping.includes("full_name") && !mapping.includes("first_name")) return { ok: false, message: "Elegí qué columna tiene el nombre." };
  const preview = buildImport(table, mapping, { areaCode: text(form, "area_code"), sameAs: postedSameAs(form) });
  if (!preview.patients.length) return { ok: false, message: "No encontramos pacientes en la planilla." };

  const types = await sql<Array<{ id: string; name: string }>>`select id, name from appointment_types where clinic_id = ${clinic.id}`;
  const unmatched = new Set<string>();
  const serviceType = new Map<string, string | null>();
  const typeFor = (service: string) => {
    if (!service) return null;
    if (!serviceType.has(service)) {
      const match = matchService(service, types);
      serviceType.set(service, match?.id ?? null);
      if (!match) unmatched.add(service);
    }
    return serviceType.get(service) ?? null;
  };
  const actor = user.role === "admin" ? "Turnia" : user.label || "El consultorio";
  const source = text(form, "source")?.slice(0, 120) ?? "Planilla pegada";

  const counts = await sql.begin(async (tx) => {
    // Una importación por clínica a la vez: dos pestañas no crean las mismas fichas dos veces.
    await tx`select pg_advisory_xact_lock(hashtextextended(${`importar-pacientes:${clinic.id}`}, 0))`;
    const [record] = await tx<Array<{ id: string }>>`
      insert into patient_imports (clinic_id, source, actor, rows_total, skipped)
      values (${clinic.id}, ${source}, ${actor}, ${preview.rows}, ${preview.skipped})
      returning id`;
    // Las fichas que ya están (por DNI, o por celular y nombre) solo completan lo que les faltaba.
    const current = await tx<ExistingPatient[]>`
      select id, phone, full_name, dni, birth_date::text as birth_date, sex from patients where clinic_id = ${clinic.id}`;
    const phoneOf = new Map(current.map((p) => [p.id, p.phone]));
    const matches = matchExisting(preview.patients, [...current]);
    const ids = matches.map((id) => id ?? randomUUID());
    const fields = (p: ImportPatient) => ({
      full_name: p.full_name,
      phone: p.phone,
      dni: p.dni,
      email: p.email,
      birth_date: p.birth_date,
      sex: p.sex,
      address: p.address,
      coverage: p.coverage,
      coverage_plan: p.coverage_plan,
      member_number: p.member_number,
      notes: p.notes,
      next_control_at: p.next_control_at,
      next_control_reason: p.next_control_reason,
    });
    const fresh = preview.patients.flatMap((p, i) => (matches[i] ? [] : [{ id: ids[i], clinic_id: clinic.id, import_id: record.id, ...fields(p) }]));
    const known = preview.patients.flatMap((p, i) => (matches[i] ? [{ id: ids[i], ...fields(p) }] : []));
    for (let i = 0; i < fresh.length; i += 500) await tx`insert into patients ${tx(fresh.slice(i, i + 500))}`;
    for (let i = 0; i < known.length; i += 500) {
      // Las notas de la planilla se suman a las que había (si no estaban ya); el control importado manda.
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
            else p.notes || E'\n' || x.notes end,
          next_control_at = coalesce(x.next_control_at, p.next_control_at),
          next_control_reason = case when x.next_control_at is not null then x.next_control_reason else p.next_control_reason end
        from json_to_recordset(${json(known.slice(i, i + 500))}::json) as x(
          id uuid, full_name text, phone text, dni text, email text, birth_date date, sex text, address text, coverage text,
          coverage_plan text, member_number text, notes text, next_control_at date, next_control_reason text)
        where p.id = x.id and p.clinic_id = ${clinic.id}`;
    }

    // Otros celulares de la misma persona: llevan a su ficha (sin cambiar a quién lleva un número que ya se usa).
    const links = preview.patients.flatMap((p, i) => {
      const own = matches[i] ? (phoneOf.get(matches[i]!) ?? p.phone) : p.phone;
      return [p.phone, ...p.other_phones]
        .filter((phone): phone is string => Boolean(phone) && phone !== own)
        .map((phone) => ({ clinic_id: clinic.id, phone, patient_id: ids[i] }));
    });
    for (let i = 0; i < links.length; i += 500) {
      await tx`insert into patient_phones ${tx(links.slice(i, i + 500))} on conflict (clinic_id, phone) do nothing`;
    }

    let visits = 0;
    const visitRows = preview.patients.flatMap((p, i) =>
      p.visits.map((v) => ({
        clinic_id: clinic.id,
        patient_id: ids[i],
        appointment_type_id: typeFor(v.service),
        service: v.service,
        professional: v.professional,
        visited_at: v.visited_at,
        import_id: record.id,
      })),
    );
    for (let j = 0; j < visitRows.length; j += 1000) {
      const inserted = await tx`
        insert into patient_visits ${tx(visitRows.slice(j, j + 1000))}
        on conflict (patient_id, visited_at, service) do nothing
        returning id`;
      visits += inserted.length;
    }
    const created = fresh.length;
    const existing = known.length;
    await tx`update patient_imports set created_patients = ${created}, updated_patients = ${existing}, visits = ${visits} where id = ${record.id}`;
    return { created, existing, visits };
  });

  const perPhone = new Map<string, number>();
  for (const p of preview.patients) if (p.phone) perPhone.set(p.phone, (perPhone.get(p.phone) ?? 0) + 1);
  const sharedPhones = [...perPhone.values()].filter((n) => n > 1).length;

  revalidatePath("/panel/pacientes");
  refresh();
  return {
    ok: true,
    message: `Listo: ${counts.created} pacientes nuevos y ${counts.existing} que ya estaban, con ${counts.visits} visitas.`,
    summary: { ...counts, skipped: preview.skipped, withoutPhone: preview.withoutPhone, sharedPhones, unmatched: [...unmatched].slice(0, 20) },
  };
}

/** Deshace una importación: borra sus visitas y las fichas que creó, si todavía no tienen actividad. */
export async function undoImportAction(form: FormData) {
  await requirePanelSession();
  const clinic = await getPanelClinic(form);
  const id = uuid(form, "id");
  if (!id) return;
  await sql.begin(async (tx) => {
    const [record] = await tx`select id from patient_imports where id = ${id} and clinic_id = ${clinic.id} and undone_at is null for update`;
    if (!record) return;
    await tx`delete from patient_visits where import_id = ${id}`;
    await tx`
      delete from patients p where p.import_id = ${id} and p.clinic_id = ${clinic.id}
        and not exists (select 1 from appointments a where a.patient_id = p.id)
        and not exists (select 1 from conversations c where c.patient_id = p.id)
        and not exists (select 1 from tasks t where t.patient_id = p.id)
        and not exists (select 1 from waitlist w where w.patient_id = p.id)
        and not exists (select 1 from campaign_recipients r where r.patient_id = p.id and r.sent_at is not null)`;
    await tx`update patient_imports set undone_at = now() where id = ${id}`;
  });
  revalidatePath("/panel/pacientes");
  revalidatePath("/panel/pacientes/importar");
  refresh();
}
