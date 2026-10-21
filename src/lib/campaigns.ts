import "server-only";
import { sql } from "./db";
import { getClinic } from "./clinic";
import { pauseBetweenSends, sendPatientMessage, templateKeyFor, whatsappReadiness } from "./whatsapp";
import { humanSlot } from "./time";
import type { Campaign, CampaignType, Clinic } from "./types";

// "Activa": campañas salientes por WhatsApp. Cada destinatario recibe un
// template aprobado por Meta (o el mismo texto por WAHA) y, si responde, lo
// atiende el mismo agente con el contexto de la campaña. Quien pidió la baja (contact_opt_out) solo recibe
// los recordatorios de sus turnos y los avisos de la lista de espera.

export const CAMPAIGN_LABELS: Record<CampaignType, { label: string; description: string; goal: string }> = {
  recall: {
    label: "Recall de controles",
    description: "Pacientes con un control periódico vencido (limpieza, lunares, chequeo anual…).",
    goal: "Que el paciente reserve su control periódico.",
  },
  reactivacion: {
    label: "Reactivación",
    description: "Pacientes que no vienen hace más de 12 meses y no tienen turnos futuros.",
    goal: "Que el paciente vuelva a atenderse y reserve un turno.",
  },
  recordatorio: {
    label: "Recordatorio de turno",
    description: "Turnos de mañana: confirmar asistencia o reprogramar.",
    goal: "Que el paciente confirme que viene, o reprograme/cancele si no puede.",
  },
  no_show: {
    label: "Recupero de ausentes",
    description: "Pacientes que faltaron en los últimos 30 días y no volvieron a sacar turno.",
    goal: "Que el paciente reprograme el turno al que faltó.",
  },
  lista_espera: {
    label: "Lista de espera",
    description: "Pacientes anotados en la lista de espera activa.",
    goal: "Ofrecerle los turnos disponibles más cercanos.",
  },
  encuesta: {
    label: "Encuesta post-consulta",
    description: "Pacientes atendidos en los últimos 2 días: puntaje del 0 al 10 y comentarios.",
    goal: "Que el paciente responda del 0 al 10 si recomendaría la clínica y cuente cómo fue su atención.",
  },
  personalizada: {
    label: "Personalizada",
    description: "Todos los pacientes con WhatsApp. Útil para avisos (ej. cambio de horario).",
    goal: "Informar el aviso y resolver dudas.",
  },
};

export type AudienceMember = { patient_id: string; phone: string; name: string | null; detail: string; context: string };

const MAX_PER_RUN = 50;
const isWhatsAppId = (phone: string) => /^\d{8,15}$/.test(phone);

type PatientRow = { id: string; full_name: string | null; phone: string };

async function futureAppointmentPatientIds(clinicId: string): Promise<Set<string>> {
  const rows = await sql<Array<{ patient_id: string }>>`
    select distinct patient_id from appointments
    where clinic_id = ${clinicId} and status in ('confirmado', 'pendiente') and starts_at >= now()`;
  return new Set(rows.map((r) => r.patient_id));
}

export async function computeAudience(clinic: Clinic, type: CampaignType): Promise<AudienceMember[]> {
  const now = Date.now();
  const future = await futureAppointmentPatientIds(clinic.id);
  const members: AudienceMember[] = [];

  if (type === "recordatorio") {
    const from = new Date(now + 12 * 3600_000);
    const to = new Date(now + 36 * 3600_000);
    const rows = await sql<Array<{ id: string; starts_at: string; patient: PatientRow; professional: string; type_name: string }>>`
      select a.id, a.starts_at, pr.full_name as professional, t.name as type_name,
             json_build_object('id', p.id, 'full_name', p.full_name, 'phone', p.phone) as patient
      from appointments a
      join patients p on p.id = a.patient_id
      join professionals pr on pr.id = a.professional_id
      join appointment_types t on t.id = a.appointment_type_id
      where a.clinic_id = ${clinic.id} and a.status in ('confirmado', 'pendiente') and a.reminder_sent_at is null
        and a.starts_at >= ${from} and a.starts_at <= ${to}
      order by a.starts_at`;
    for (const r of rows) {
      const when = humanSlot(new Date(r.starts_at), clinic.timezone);
      members.push({
        patient_id: r.patient.id,
        phone: r.patient.phone,
        name: r.patient.full_name,
        detail: `${when} con ${r.professional}`,
        context: `Recordatorio del turno de ${r.type_name} el ${when} con ${r.professional} (turno_id=${r.id}). Pedile que confirme si viene: si dice que sí, usá confirmar_turno; si no puede, ofrecé reprogramar o cancelar.`,
      });
    }
    return members;
  }

  if (type === "recall" || type === "reactivacion") {
    // Último turno atendido de cada paciente (recall: de cada paciente y tipo de turno).
    const rows = await sql<
      Array<{ patient_id: string; starts_at: string; appointment_type_id: string; type_name: string; recall_months: number | null; full_name: string | null; phone: string }>
    >`
      select distinct on (a.patient_id ${type === "recall" ? sql`, a.appointment_type_id` : sql``})
             a.patient_id, a.starts_at, a.appointment_type_id, t.name as type_name, t.recall_months, p.full_name, p.phone
      from appointments a
      join patients p on p.id = a.patient_id
      join appointment_types t on t.id = a.appointment_type_id
      where a.clinic_id = ${clinic.id} and a.status = 'atendido' and not p.contact_opt_out
      order by a.patient_id ${type === "recall" ? sql`, a.appointment_type_id` : sql``}, a.starts_at desc`;
    const seen = new Set<string>();
    for (const r of [...rows].sort((a, b) => b.starts_at.localeCompare(a.starts_at))) {
      if (seen.has(r.patient_id) || future.has(r.patient_id)) continue;
      const monthsAgo = (now - new Date(r.starts_at).getTime()) / (30.44 * 86400_000);
      if (type === "recall") {
        const every = r.recall_months;
        if (!every || monthsAgo < every) continue;
        seen.add(r.patient_id);
        members.push({
          patient_id: r.patient_id,
          phone: r.phone,
          name: r.full_name,
          detail: r.type_name.toLowerCase(),
          context: `Campaña de recall: su último turno de "${r.type_name}" (tipo_turno_id=${r.appointment_type_id}) fue hace ${Math.round(monthsAgo)} meses y corresponde hacerlo cada ${every}. Ofrecé turnos para ese control.`,
        });
      } else {
        seen.add(r.patient_id);
        if (monthsAgo < 12) continue;
        members.push({
          patient_id: r.patient_id,
          phone: r.phone,
          name: r.full_name,
          detail: clinic.name,
          context: `Campaña de reactivación: no viene a la clínica hace ${Math.round(monthsAgo)} meses (último turno: ${r.type_name}). Preguntá cómo está y ofrecé un turno.`,
        });
      }
    }
    return members;
  }

  if (type === "no_show") {
    const rows = await sql<Array<{ patient_id: string; appointment_type_id: string; type_name: string; full_name: string | null; phone: string }>>`
      select a.patient_id, a.appointment_type_id, t.name as type_name, p.full_name, p.phone
      from appointments a
      join patients p on p.id = a.patient_id
      join appointment_types t on t.id = a.appointment_type_id
      where a.clinic_id = ${clinic.id} and a.status = 'ausente' and a.starts_at >= ${new Date(now - 30 * 86400_000)}
        and not p.contact_opt_out
      order by a.starts_at desc`;
    const seen = new Set<string>();
    for (const r of rows) {
      if (seen.has(r.patient_id) || future.has(r.patient_id)) continue;
      seen.add(r.patient_id);
      members.push({
        patient_id: r.patient_id,
        phone: r.phone,
        name: r.full_name,
        detail: r.type_name.toLowerCase(),
        context: `Recupero de ausente: faltó a su turno de "${r.type_name}" (tipo_turno_id=${r.appointment_type_id}). Sin retar, ofrecé reprogramarlo.`,
      });
    }
    return members;
  }

  if (type === "encuesta") {
    const rows = await sql<Array<{ id: string; patient: PatientRow; professional: string; type_name: string }>>`
      select a.id, pr.full_name as professional, t.name as type_name,
             json_build_object('id', p.id, 'full_name', p.full_name, 'phone', p.phone) as patient
      from appointments a
      join patients p on p.id = a.patient_id
      join professionals pr on pr.id = a.professional_id
      join appointment_types t on t.id = a.appointment_type_id
      where a.clinic_id = ${clinic.id} and a.status = 'atendido' and a.survey_sent_at is null and not p.contact_opt_out
        and a.starts_at >= ${new Date(now - 48 * 3600_000)} and a.starts_at <= ${new Date(now)}
      order by a.starts_at`;
    const seen = new Set<string>();
    for (const r of rows) {
      if (seen.has(r.patient.id)) continue;
      seen.add(r.patient.id);
      members.push({
        patient_id: r.patient.id,
        phone: r.patient.phone,
        name: r.patient.full_name,
        detail: `tu ${r.type_name.toLowerCase()} con ${r.professional}`,
        context: `Encuesta post-consulta: se atendió de "${r.type_name}" con ${r.professional} (turno_id=${r.id}). Preguntá del 0 al 10 qué tan probable es que recomiende la clínica y si quiere contar algo más.`,
      });
    }
    return members;
  }

  if (type === "lista_espera") {
    const rows = await sql<
      Array<{ patient_id: string; appointment_type_id: string | null; preferences: string | null; type_name: string | null; full_name: string | null; phone: string }>
    >`
      select distinct on (w.patient_id) w.patient_id, w.appointment_type_id, w.preferences, t.name as type_name, p.full_name, p.phone
      from waitlist w
      join patients p on p.id = w.patient_id
      left join appointment_types t on t.id = w.appointment_type_id
      where w.clinic_id = ${clinic.id} and w.status = 'activa'
      order by w.patient_id, w.created_at`;
    for (const r of rows) {
      members.push({
        patient_id: r.patient_id,
        phone: r.phone,
        name: r.full_name,
        detail: r.type_name?.toLowerCase() ?? "tu turno",
        context: `Está en lista de espera para "${r.type_name ?? "un turno"}" (tipo_turno_id=${r.appointment_type_id}). Preferencias: ${r.preferences ?? "sin datos"}. Consultá disponibilidad y ofrecé lo más cercano.`,
      });
    }
    return members;
  }

  const rows = await sql<PatientRow[]>`
    select id, full_name, phone from patients where clinic_id = ${clinic.id} and not contact_opt_out order by created_at`;
  return rows.map((r) => ({ patient_id: r.id, phone: r.phone, name: r.full_name, detail: clinic.name, context: "Aviso general de la clínica." }));
}

export async function createCampaign(input: {
  clinicId: string;
  name: string;
  type: CampaignType;
  templateName: string;
  templateLanguage?: string;
  goal?: string;
}): Promise<Campaign> {
  const [campaign] = await sql<Campaign[]>`
    insert into campaigns ${sql({
      clinic_id: input.clinicId,
      name: input.name,
      type: input.type,
      template_name: input.templateName,
      template_language: input.templateLanguage || "es_AR",
      goal: input.goal || CAMPAIGN_LABELS[input.type].goal,
    })}
    returning *`;
  return campaign;
}

export type SendResult = { audience: number; sent: number; failed: number; skipped: number; errors: string[] };

export async function sendCampaign(campaignId: string): Promise<SendResult> {
  const [campaign] = await sql<Campaign[]>`select * from campaigns where id = ${campaignId}`;
  if (!campaign) throw new Error("No encontré la campaña.");
  const clinic = await getClinic(campaign.clinic_id);
  const problem = whatsappReadiness(clinic);
  if (problem) throw new Error(problem);

  const audience = await computeAudience(clinic, campaign.type);
  const already = await sql<Array<{ patient_id: string; status: string }>>`
    select patient_id, status from campaign_recipients where campaign_id = ${campaign.id}`;
  const done = new Set(already.filter((r) => r.status !== "pendiente" && r.status !== "error").map((r) => r.patient_id));

  await sql`update campaigns set status = 'enviando' where id = ${campaign.id}`;
  const result: SendResult = { audience: audience.length, sent: 0, failed: 0, skipped: 0, errors: [] };

  let attempts = 0;
  for (const member of audience.slice(0, MAX_PER_RUN)) {
    if (done.has(member.patient_id) || !isWhatsAppId(member.phone)) {
      result.skipped++;
      continue;
    }
    if (attempts++ > 0) await pauseBetweenSends(clinic);
    const firstName = member.name?.split(" ")[0] || "hola";
    const context = `${member.context} Objetivo de la campaña "${campaign.name}": ${campaign.goal}`;
    try {
      const res = await sendPatientMessage(clinic, {
        phone: member.phone,
        templateKey: templateKeyFor(campaign.type),
        templateName: campaign.template_name,
        language: campaign.template_language,
        params: [firstName, member.detail],
        context,
        campaignId: campaign.id,
      });
      await sql`
        insert into campaign_recipients (campaign_id, patient_id, status, elevenlabs_conversation_id, sent_at, error)
        values (${campaign.id}, ${member.patient_id}, 'enviado', ${res.conversation_id ?? null}, now(), null)
        on conflict (campaign_id, patient_id) do update set
          status = excluded.status, elevenlabs_conversation_id = excluded.elevenlabs_conversation_id,
          sent_at = excluded.sent_at, error = null`;
      const appointmentId = /turno_id=([0-9a-f-]{36})/.exec(member.context)?.[1];
      if (appointmentId && campaign.type === "recordatorio") await sql`update appointments set reminder_sent_at = now() where id = ${appointmentId}`;
      if (appointmentId && campaign.type === "encuesta") await sql`update appointments set survey_sent_at = now() where id = ${appointmentId}`;
      result.sent++;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      result.failed++;
      result.errors.push(`${member.name ?? member.phone}: ${message.slice(0, 200)}`);
      await sql`
        insert into campaign_recipients (campaign_id, patient_id, status, error)
        values (${campaign.id}, ${member.patient_id}, 'error', ${message.slice(0, 500)})
        on conflict (campaign_id, patient_id) do update set status = 'error', error = excluded.error`;
    }
  }

  await sql`update campaigns set status = 'finalizada', sent_at = now() where id = ${campaign.id}`;
  return result;
}

/** Corre una campaña automática (la dispara n8n o un cron). */
export async function runAutomation(type: CampaignType, clinicId?: string): Promise<SendResult & { campaign_id: string }> {
  const clinic = await getClinic(clinicId);
  // Por WAHA no hay templates de Meta: se manda el texto de TEMPLATE_TEXTS.
  const templateName = clinic.templates?.[type] ?? (clinic.whatsapp_provider === "waha" ? type : null);
  if (!templateName) throw new Error(`No hay template configurado para "${type}" (Configuración → Templates).`);
  const today = new Intl.DateTimeFormat("es-AR", { timeZone: clinic.timezone, day: "numeric", month: "short" }).format(new Date());
  const campaign = await createCampaign({
    clinicId: clinic.id,
    name: `${CAMPAIGN_LABELS[type].label} · automática ${today}`,
    type,
    templateName,
    templateLanguage: clinic.templates?.idioma || "es_AR",
  });
  const result = await sendCampaign(campaign.id);
  return { ...result, campaign_id: campaign.id };
}
