import "server-only";
import { db, unwrap } from "./supabase";
import { buildDynamicVariables, getClinic } from "./clinic";
import { sendWhatsAppTemplate } from "./elevenlabs";
import { humanSlot } from "./time";
import type { Campaign, CampaignType, Clinic } from "./types";

// "Activa": campañas salientes por WhatsApp. Cada destinatario recibe un
// template aprobado por Meta y, si responde, lo atiende el mismo agente con el
// contexto de la campaña.

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
  const rows = unwrap(
    await db()
      .from("appointments")
      .select("patient_id")
      .eq("clinic_id", clinicId)
      .in("status", ["confirmado", "pendiente"])
      .gte("starts_at", new Date().toISOString()),
    "turnos futuros",
  ) as Array<{ patient_id: string }>;
  return new Set(rows.map((r) => r.patient_id));
}

export async function computeAudience(clinic: Clinic, type: CampaignType): Promise<AudienceMember[]> {
  const now = Date.now();
  const future = await futureAppointmentPatientIds(clinic.id);
  const members: AudienceMember[] = [];

  if (type === "recordatorio") {
    const from = new Date(now + 12 * 3600_000).toISOString();
    const to = new Date(now + 36 * 3600_000).toISOString();
    const rows = unwrap(
      await db()
        .from("appointments")
        .select("id, starts_at, professional_id, appointment_type_id, patients(id, full_name, phone), professionals(full_name), appointment_types(name)")
        .eq("clinic_id", clinic.id)
        .eq("status", "confirmado")
        .is("reminder_sent_at", null)
        .gte("starts_at", from)
        .lte("starts_at", to),
      "turnos de mañana",
    ) as unknown as Array<{
      id: string;
      starts_at: string;
      patients: PatientRow | null;
      professionals: { full_name: string } | null;
      appointment_types: { name: string } | null;
    }>;
    for (const r of rows) {
      if (!r.patients) continue;
      const when = humanSlot(new Date(r.starts_at), clinic.timezone);
      members.push({
        patient_id: r.patients.id,
        phone: r.patients.phone,
        name: r.patients.full_name,
        detail: `${when} con ${r.professionals?.full_name ?? "el profesional"}`,
        context: `Recordatorio del turno de ${r.appointment_types?.name ?? "consulta"} el ${when} con ${r.professionals?.full_name} (turno_id=${r.id}). Pedile que confirme si viene; si no puede, ofrecé reprogramar o cancelar.`,
      });
    }
    return members;
  }

  if (type === "recall" || type === "reactivacion") {
    const rows = unwrap(
      await db()
        .from("appointments")
        .select("patient_id, starts_at, appointment_type_id, appointment_types(name, recall_months), patients(id, full_name, phone)")
        .eq("clinic_id", clinic.id)
        .eq("status", "atendido")
        .order("starts_at", { ascending: false }),
      "historial",
    ) as unknown as Array<{
      patient_id: string;
      starts_at: string;
      appointment_type_id: string;
      appointment_types: { name: string; recall_months: number | null } | null;
      patients: PatientRow | null;
    }>;
    const seen = new Set<string>();
    for (const r of rows) {
      if (!r.patients || seen.has(r.patient_id) || future.has(r.patient_id)) continue;
      seen.add(r.patient_id);
      const monthsAgo = (now - new Date(r.starts_at).getTime()) / (30.44 * 86400_000);
      if (type === "recall") {
        const every = r.appointment_types?.recall_months;
        if (!every || monthsAgo < every) continue;
        members.push({
          patient_id: r.patient_id,
          phone: r.patients.phone,
          name: r.patients.full_name,
          detail: r.appointment_types!.name.toLowerCase(),
          context: `Campaña de recall: su último turno de "${r.appointment_types!.name}" (tipo_turno_id=${r.appointment_type_id}) fue hace ${Math.round(monthsAgo)} meses y corresponde hacerlo cada ${every}. Ofrecé turnos para ese control.`,
        });
      } else if (monthsAgo >= 12) {
        members.push({
          patient_id: r.patient_id,
          phone: r.patients.phone,
          name: r.patients.full_name,
          detail: clinic.name,
          context: `Campaña de reactivación: no viene a la clínica hace ${Math.round(monthsAgo)} meses (último turno: ${r.appointment_types?.name}). Preguntá cómo está y ofrecé un turno.`,
        });
      }
    }
    return members;
  }

  if (type === "no_show") {
    const rows = unwrap(
      await db()
        .from("appointments")
        .select("patient_id, starts_at, appointment_type_id, appointment_types(name), patients(id, full_name, phone)")
        .eq("clinic_id", clinic.id)
        .eq("status", "ausente")
        .gte("starts_at", new Date(now - 30 * 86400_000).toISOString()),
      "ausentes",
    ) as unknown as Array<{ patient_id: string; appointment_type_id: string; appointment_types: { name: string } | null; patients: PatientRow | null }>;
    const seen = new Set<string>();
    for (const r of rows) {
      if (!r.patients || seen.has(r.patient_id) || future.has(r.patient_id)) continue;
      seen.add(r.patient_id);
      members.push({
        patient_id: r.patient_id,
        phone: r.patients.phone,
        name: r.patients.full_name,
        detail: r.appointment_types?.name.toLowerCase() ?? "tu turno",
        context: `Recupero de ausente: faltó a su turno de "${r.appointment_types?.name}" (tipo_turno_id=${r.appointment_type_id}). Sin retar, ofrecé reprogramarlo.`,
      });
    }
    return members;
  }

  if (type === "lista_espera") {
    const rows = unwrap(
      await db()
        .from("waitlist")
        .select("patient_id, appointment_type_id, preferences, appointment_types(name), patients(id, full_name, phone)")
        .eq("clinic_id", clinic.id)
        .eq("status", "activa"),
      "lista de espera",
    ) as unknown as Array<{
      patient_id: string;
      appointment_type_id: string | null;
      preferences: string | null;
      appointment_types: { name: string } | null;
      patients: PatientRow | null;
    }>;
    for (const r of rows) {
      if (!r.patients) continue;
      members.push({
        patient_id: r.patient_id,
        phone: r.patients.phone,
        name: r.patients.full_name,
        detail: r.appointment_types?.name.toLowerCase() ?? "tu turno",
        context: `Está en lista de espera para "${r.appointment_types?.name}" (tipo_turno_id=${r.appointment_type_id}). Preferencias: ${r.preferences ?? "sin datos"}. Consultá disponibilidad y ofrecé lo más cercano.`,
      });
    }
    return members;
  }

  const rows = unwrap(await db().from("patients").select("id, full_name, phone").eq("clinic_id", clinic.id), "pacientes") as PatientRow[];
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
  return unwrap(
    await db()
      .from("campaigns")
      .insert({
        clinic_id: input.clinicId,
        name: input.name,
        type: input.type,
        template_name: input.templateName,
        template_language: input.templateLanguage || "es_AR",
        goal: input.goal || CAMPAIGN_LABELS[input.type].goal,
      })
      .select("*")
      .single(),
    "crear campaña",
  ) as Campaign;
}

export type SendResult = { audience: number; sent: number; failed: number; skipped: number; errors: string[] };

export async function sendCampaign(campaignId: string): Promise<SendResult> {
  const campaign = unwrap(await db().from("campaigns").select("*").eq("id", campaignId).single(), "campaña") as Campaign;
  const clinic = await getClinic(campaign.clinic_id);
  if (!clinic.whatsapp_phone_number_id) throw new Error("Falta el ID del número de WhatsApp en Configuración.");
  if (!clinic.elevenlabs_agent_id) throw new Error("Primero creá el agente en Configuración.");

  const audience = await computeAudience(clinic, campaign.type);
  const already = unwrap(
    await db().from("campaign_recipients").select("patient_id, status").eq("campaign_id", campaign.id),
    "destinatarios",
  ) as Array<{ patient_id: string; status: string }>;
  const done = new Set(already.filter((r) => r.status !== "pendiente" && r.status !== "error").map((r) => r.patient_id));

  await db().from("campaigns").update({ status: "enviando" }).eq("id", campaign.id);
  const result: SendResult = { audience: audience.length, sent: 0, failed: 0, skipped: 0, errors: [] };

  for (const member of audience.slice(0, MAX_PER_RUN)) {
    if (done.has(member.patient_id) || !isWhatsAppId(member.phone)) {
      result.skipped++;
      continue;
    }
    const firstName = member.name?.split(" ")[0] || "hola";
    const context = `${member.context} Objetivo de la campaña "${campaign.name}": ${campaign.goal}`;
    try {
      const res = await sendWhatsAppTemplate({
        phoneNumberId: clinic.whatsapp_phone_number_id,
        userId: member.phone,
        templateName: campaign.template_name,
        language: campaign.template_language,
        params: [firstName, member.detail],
        agentId: clinic.elevenlabs_agent_id,
        dynamicVariables: await buildDynamicVariables(clinic, member.phone, { context, campaignId: campaign.id }),
      });
      await db().from("campaign_recipients").upsert(
        {
          campaign_id: campaign.id,
          patient_id: member.patient_id,
          status: "enviado",
          elevenlabs_conversation_id: res.conversation_id ?? null,
          sent_at: new Date().toISOString(),
          error: null,
        },
        { onConflict: "campaign_id,patient_id" },
      );
      if (campaign.type === "recordatorio") {
        const match = /turno_id=([0-9a-f-]{36})/.exec(member.context);
        if (match) await db().from("appointments").update({ reminder_sent_at: new Date().toISOString() }).eq("id", match[1]);
      }
      result.sent++;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      result.failed++;
      result.errors.push(`${member.name ?? member.phone}: ${message.slice(0, 200)}`);
      await db()
        .from("campaign_recipients")
        .upsert(
          { campaign_id: campaign.id, patient_id: member.patient_id, status: "error", error: message.slice(0, 500) },
          { onConflict: "campaign_id,patient_id" },
        );
    }
  }

  await db().from("campaigns").update({ status: "finalizada", sent_at: new Date().toISOString() }).eq("id", campaign.id);
  return result;
}

/** Corre una campaña automática (la dispara n8n o un cron). */
export async function runAutomation(type: CampaignType, clinicId?: string): Promise<SendResult & { campaign_id: string }> {
  const clinic = await getClinic(clinicId);
  const templateKey = type === "recall" ? "recall" : type;
  const templateName = clinic.templates?.[templateKey];
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
