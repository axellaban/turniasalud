"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { isUuid } from "@/lib/clinic";
import { markManualSent, prepareCampaign, sendCampaign, setRecipientIncluded, syncAudience } from "@/lib/campaigns";
import { getPanelClinic, logClinicChange, requirePanelSession, touchClinic } from "@/lib/panel-clinic";
import { IMPORT_FIELDS, buildImport, detectMapping, matchService, parseTable, type ColumnMapping, type ImportField } from "@/lib/patient-import";
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
  summary?: { created: number; existing: number; visits: number; skipped: number; unmatched: string[] };
};

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
  if (!mapping.includes("phone")) return { ok: false, message: "Elegí qué columna tiene el celular." };
  if (!mapping.includes("full_name") && !mapping.includes("first_name")) return { ok: false, message: "Elegí qué columna tiene el nombre." };
  const preview = buildImport(table, mapping);
  if (!preview.patients.length) return { ok: false, message: "No encontramos filas con un celular válido." };

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
    const [record] = await tx<Array<{ id: string }>>`
      insert into patient_imports (clinic_id, source, actor, rows_total, skipped)
      values (${clinic.id}, ${source}, ${actor}, ${preview.rows}, ${preview.problems.length})
      returning id`;
    let created = 0;
    let existing = 0;
    let visits = 0;
    for (let i = 0; i < preview.patients.length; i += 500) {
      const chunk = preview.patients.slice(i, i + 500);
      const rows = chunk.map((p) => ({
        clinic_id: clinic.id,
        full_name: p.full_name,
        phone: p.phone,
        dni: p.dni,
        email: p.email,
        birth_date: p.birth_date,
        coverage: p.coverage,
        coverage_plan: p.coverage_plan,
        member_number: p.member_number,
        notes: p.notes,
        next_control_at: p.next_control_at,
        next_control_reason: p.next_control_reason,
        import_id: record.id,
      }));
      // Las fichas que ya existían solo completan lo que les faltaba; el control importado manda.
      const saved = await tx<Array<{ id: string; phone: string; inserted: boolean }>>`
        insert into patients ${tx(rows)}
        on conflict (clinic_id, phone) do update set
          full_name = coalesce(patients.full_name, excluded.full_name),
          dni = coalesce(patients.dni, excluded.dni),
          email = coalesce(patients.email, excluded.email),
          birth_date = coalesce(patients.birth_date, excluded.birth_date),
          coverage = coalesce(patients.coverage, excluded.coverage),
          coverage_plan = coalesce(patients.coverage_plan, excluded.coverage_plan),
          member_number = coalesce(patients.member_number, excluded.member_number),
          notes = coalesce(patients.notes, excluded.notes),
          next_control_at = coalesce(excluded.next_control_at, patients.next_control_at),
          next_control_reason = case when excluded.next_control_at is not null then excluded.next_control_reason else patients.next_control_reason end
        returning id, phone, (xmax = 0) as inserted`;
      created += saved.filter((s) => s.inserted).length;
      existing += saved.filter((s) => !s.inserted).length;
      const ids = new Map(saved.map((s) => [s.phone, s.id]));
      const visitRows = chunk.flatMap((p) =>
        p.visits.map((v) => ({
          clinic_id: clinic.id,
          patient_id: ids.get(p.phone)!,
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
    }
    await tx`update patient_imports set created_patients = ${created}, updated_patients = ${existing}, visits = ${visits} where id = ${record.id}`;
    return { created, existing, visits };
  });

  revalidatePath("/panel/pacientes");
  refresh();
  return {
    ok: true,
    message: `Listo: ${counts.created} pacientes nuevos y ${counts.existing} que ya estaban, con ${counts.visits} visitas.`,
    summary: { ...counts, skipped: preview.problems.length, unmatched: [...unmatched].slice(0, 20) },
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
