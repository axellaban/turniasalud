import "server-only";
import { claimProfileHandoff } from "./handoff";
import { randomBytes } from "node:crypto";
import { sql } from "../db";
import { saveInitialImport } from "../clinic-imports";
import type { ScrapeResult } from "./scraper";
import { env } from "../env";
import { buildDynamicVariables, getClinic } from "../clinic";
import { forwardToAgent } from "../channel";
import { startPhoneCall } from "../elevenlabs";
import { notifyN8n } from "../n8n";
import { sendChatText } from "../messaging";
import { channelForChat, chatIsActive, requireActiveChannel } from "../messaging-settings";
import type { Clinic } from "../types";
import { DEMO_TEXTS, demoAgentContext, hostOf, parseCommand, parseDemoRequest, parseModeChoice, type DemoMode, type DemoStatus } from "./flow";
import { buildProfile, type DemoProfile } from "./profile";
import { ScrapeError, scrapeSite } from "./scraper";

// Lead magnet por WhatsApp: el interesado manda su web, Turnia la lee, arma
// una clínica temporal con esos datos y el agente lo atiende como si fuera un
// paciente de ese consultorio, por llamada, audios o chat.

/** Una demo sigue activa mientras haya mensajes en este lapso. */
const ACTIVE_HOURS = 24;
/** Si el análisis no terminó en este tiempo (la función se cortó), se avisa y se puede reintentar. */
const STUCK_MINUTES = 4;
const KEEP_DEMO_CLINICS_DAYS = 7;
/** Horario de prueba cuando la web no dice cuándo atienden. */
const DEFAULT_HOURS = [1, 2, 3, 4, 5].map((dia) => ({ dia, desde: "09:00", hasta: "18:00" }));

export type DemoSession = {
  id: string;
  channel_revision: number;
  phone: string;
  chat_id: string;
  website: string;
  status: DemoStatus;
  clinic_id: string | null;
  lead_id: string | null;
  call_token: string | null;
  pages_read: number | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type DemoInput = { messageId: string; chatId: string; phone: string; text: string };
/** handled: el mensaje era de la demo. analyze: id de la demo cuya web hay que leer después de responder. */
export type DemoOutcome = { handled: true; status: DemoStatus; analyze?: string };

async function latestSession(phone: string): Promise<DemoSession | null> {
  const [s] = await sql<DemoSession[]>`
    select * from demo_sessions
    where phone = ${phone} and updated_at > now() - make_interval(hours => ${ACTIVE_HOURS})
    order by updated_at desc limit 1`;
  return s ?? null;
}

async function setStatus(id: string, status: DemoStatus, extra: { error?: string | null } = {}): Promise<void> {
  await sql`update demo_sessions set status = ${status}, error = ${extra.error ?? null}, updated_at = now() where id = ${id}`;
}

/**
 * Decide si un mensaje de WhatsApp es parte de la demo. Devuelve null si no
 * (lo atiende la clínica de siempre).
 */
export async function handleDemoMessage(input: DemoInput): Promise<DemoOutcome | null> {
  await requireActiveChannel(channelForChat(input.chatId));
  // Los audios llegan transcriptos con este prefijo; para elegir opciones no cuenta.
  const said = input.text.replace(/^\(audio\)\s*/, "");
  const savedToken = /\bp_[A-Za-z0-9_-]{24}(?![A-Za-z0-9_-])/.exec(said)?.[0];
  if (savedToken && /perfil/i.test(said)) {
    const clinicId = await claimProfileHandoff(savedToken, input.phone);
    if (!clinicId) {
      await sendChatText(input.chatId, "Este enlace de perfil venció (dura 7 días) o la ficha ya no existe. Generá otro desde el panel.");
      return { handled: true, status: "terminada" };
    }
    return startSavedProfile(input, clinicId);
  }
  const request = parseDemoRequest(said);
  const session = await latestSession(input.phone);
  if (request) return startDemo(input, request.website);
  if (!session || session.status === "terminada") return null;

  // Después de un error, alcanza con mandar la dirección corregida.
  if (session.status === "error") {
    const retry = parseDemoRequest(`demo ${said}`);
    return retry ? startDemo(input, retry.website) : null;
  }

  const command = parseCommand(said);
  if (command === "salir") {
    await setStatus(session.id, "terminada");
    await closeAgentConversations(session);
    const clinic = session.clinic_id ? await demoClinic(session.clinic_id) : null;
    await sendChatText(input.chatId, DEMO_TEXTS.ended(clinic?.name ?? null));
    return { handled: true, status: "terminada" };
  }

  if (session.status === "analizando") {
    if (Date.now() - new Date(session.created_at).getTime() > STUCK_MINUTES * 60_000) {
      await setStatus(session.id, "error", { error: "El análisis no terminó a tiempo." });
      await sendChatText(input.chatId, DEMO_TEXTS.failed);
      return { handled: true, status: "error" };
    }
    await sendChatText(input.chatId, DEMO_TEXTS.stillReading);
    return { handled: true, status: "analizando" };
  }

  const clinic = session.clinic_id ? await demoClinic(session.clinic_id) : null;
  if (!clinic) {
    await setStatus(session.id, "error", { error: "La clínica de la demo ya no existe." });
    await sendChatText(input.chatId, DEMO_TEXTS.failed);
    return { handled: true, status: "error" };
  }

  if (command === "menu") {
    await closeAgentConversations(session);
    await setStatus(session.id, "eligiendo");
    await sendChatText(input.chatId, await optionsText(clinic));
    return { handled: true, status: "eligiendo" };
  }

  if (session.status === "eligiendo" || session.status === "llamada") {
    const mode = parseModeChoice(said);
    if (!mode) {
      await sql`update demo_sessions set updated_at = now() where id = ${session.id}`;
      await sendChatText(input.chatId, session.status === "llamada" ? DEMO_TEXTS.inCall : DEMO_TEXTS.chooseAgain);
      return { handled: true, status: session.status };
    }
    await startMode({ ...session, chat_id: input.chatId }, clinic, mode);
    return { handled: true, status: mode };
  }

  // chat o audio: el mensaje va al agente, con la clínica de la demo.
  await sql`update demo_sessions set updated_at = now() where id = ${session.id}`;
  await forwardToAgent(clinic, input, {
    context: demoAgentContext(clinic.name, { defaultHours: !clinic.hours_text }),
    replyWithVoice: session.status === "audio",
  });
  return { handled: true, status: session.status };
}

async function startSavedProfile(input: DemoInput, clinicId: string): Promise<DemoOutcome> {
  const settings = await requireActiveChannel(channelForChat(input.chatId));
  const [clinic] = await sql<Clinic[]>`select * from clinics where id = ${clinicId} and is_demo`;
  if (!clinic) throw new Error("La clínica del perfil ya no existe.");
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${`turnia-demo:${input.phone}`}, 0))`;
    const [existing] = await tx`select id from demo_sessions where phone = ${input.phone} and request_message_id = ${input.messageId}`;
    if (existing) return;
    await tx`update channel_conversations set closed_at = now() where phone = ${input.phone} and closed_at is null`;
    await tx`update demo_sessions set status = 'terminada', updated_at = now() where phone = ${input.phone} and status not in ('terminada', 'error')`;
    await tx`insert into demo_sessions (phone, chat_id, website, clinic_id, status, request_message_id, channel_revision, reused_profile)
      values (${input.phone}, ${input.chatId}, ${clinic.website || env.appUrl()}, ${clinic.id}, 'eligiendo', ${input.messageId}, ${settings.revision}, true)`;
  });
  await sendChatText(input.chatId, await optionsText(clinic));
  return { handled: true, status: "eligiendo" };
}

async function startDemo(input: DemoInput, website: string): Promise<DemoOutcome> {
  const settings = await requireActiveChannel(channelForChat(input.chatId));
  const source = `demo-${channelForChat(input.chatId)}`;
  const name = input.phone.startsWith("telegram:") ? `Telegram ${input.phone.slice(9)}` : `WhatsApp +${input.phone}`;
  // WAHA reintenta entregas fallidas y puede entregar varios mensajes juntos.
  // La cuota, el interesado y la sesión se deciden bajo el mismo lock por teléfono.
  const result = await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${`turnia-demo:${input.phone}`}, 0))`;
    const [retry] = await tx<DemoSession[]>`
      select * from demo_sessions where phone = ${input.phone} and request_message_id = ${input.messageId}`;
    if (retry) return { session: retry, createdLead: false };

    const [{ count }] = await tx<{ count: number }[]>`
      select count(*)::int as count from demo_sessions where phone = ${input.phone} and not reused_profile and created_at > now() - interval '1 day'`;
    // El límite diario por persona se ajusta en Panel → Sistema (sin límite por defecto).
    if (settings.demo_daily_limit && count >= settings.demo_daily_limit) return null;

    await tx`
      update channel_conversations set closed_at = now()
      where phone = ${input.phone} and closed_at is null and clinic_id in (
        select clinic_id from demo_sessions where phone = ${input.phone} and status not in ('terminada', 'error'))`;
    await tx`
      update demo_sessions set status = 'terminada', updated_at = now()
      where phone = ${input.phone} and status not in ('terminada', 'error')`;

    // Un interesado es un solo pedido en el panel, aunque pruebe varias webs.
    const note = `Probó la demo con su web: ${website}`;
    const [existing] = await tx<{ id: string }[]>`
      update leads set message = concat_ws(' · ', message, ${note}::text), updated_at = now()
      where id = (
        select id from leads where phone = ${input.phone} and source = ${source}
        order by created_at desc limit 1)
      returning id`;
    const lead = existing ?? (await tx<{ id: string }[]>`
      insert into leads (name, phone, organization, message, source)
      values (${name}, ${input.phone}, ${hostOf(website)}, ${note}, ${source})
      returning id`)[0];
    const [session] = await tx<DemoSession[]>`
      insert into demo_sessions (phone, chat_id, website, lead_id, request_message_id, channel_revision)
      values (${input.phone}, ${input.chatId}, ${website}, ${lead.id}, ${input.messageId}, ${settings.revision})
      returning *`;
    return { session, createdLead: !existing };
  });
  if (!result) {
    await sendChatText(input.chatId, DEMO_TEXTS.tooMany);
    return { handled: true, status: "terminada" };
  }
  const { session } = result;
  const host = hostOf(website);
  const note = `Probó la demo con su web: ${website}`;
  if (result.createdLead) {
    await notifyN8n("lead.nuevo", {
      // Misma forma que el formulario de /pedi-una-demo, para que el aviso de n8n lo muestre igual.
      lead: {
        id: session.lead_id,
        nombre: name,
        email: null,
        telefono: input.phone,
        organizacion: host,
        mensaje: note,
        origen: source,
        web: website,
      },
    });
  }
  if (session.status !== "analizando") return { handled: true, status: session.status };
  await sendChatText(input.chatId, DEMO_TEXTS.started(website));
  return { handled: true, status: "analizando", analyze: session.id };
}

/**
 * Lee la web, arma la clínica de la demo y le ofrece las tres opciones.
 * Corre después de responder el webhook (puede tardar ~1 minuto).
 */
export async function analyzeDemo(sessionId: string): Promise<void> {
  // Un reintento del webhook puede volver a programar este trabajo. Solo uno
  // reclama la sesión antes de consultar la web o consumir créditos de Claude.
  const [session] = await sql<DemoSession[]>`
    update demo_sessions set analysis_started_at = now()
    where id = ${sessionId} and status = 'analizando' and analysis_started_at is null
    returning *`;
  if (!session || !(await chatIsActive(session.chat_id, session.channel_revision))) return;
  try {
    const site = await scrapeSite(session.website);
    const [active] = await sql`select id from demo_sessions where id = ${session.id} and status = 'analizando'`;
    if (!active) return;
    if (!(await chatIsActive(session.chat_id, session.channel_revision))) return;
    const profile = await buildProfile(site);
    const clinic = await createDemoClinic(profile, site.url, { id: session.id, pages: site.pages.length, site });
    if (!clinic) return; // la persona salió o pidió otra demo mientras leíamos
    if (session.lead_id) {
      await sql`
        update leads set organization = ${clinic.name}, specialty = ${clinic.specialty}, updated_at = now()
        where id = ${session.lead_id}`;
    }
    await sendChatText(session.chat_id, await optionsText(clinic));
  } catch (e) {
    const scrapeFailed = e instanceof ScrapeError;
    console.error("Demo: no se pudo preparar", session.website, e instanceof Error ? e.message : e);
    const [failed] = await sql`
      update demo_sessions set status = 'error', error = ${e instanceof Error ? e.message.slice(0, 300) : "error"}, updated_at = now()
      where id = ${session.id} and status in ('analizando', 'eligiendo') returning id`;
    if (failed) await sendChatText(session.chat_id, scrapeFailed ? DEMO_TEXTS.scrapeFailed(session.website) : DEMO_TEXTS.failed).catch(() => {});
  }
}

async function demoClinic(id: string): Promise<Clinic | null> {
  const [clinic] = await sql<Clinic[]>`select * from clinics where id = ${id} and is_demo`;
  return clinic ?? null;
}

async function optionsText(clinic: Clinic): Promise<string> {
  const [counts] = await sql<{ professionals: number; types: number }[]>`
    select (select count(*)::int from professionals where clinic_id = ${clinic.id}) as professionals,
           (select count(*)::int from appointment_types where clinic_id = ${clinic.id}) as types`;
  const coverages = clinic.accepted_coverages.filter((c) => !/particular/i.test(c)).length;
  return DEMO_TEXTS.options({ name: clinic.name, professionals: counts.professionals, types: counts.types, coverages });
}

/** Al cambiar de modo o salir, la próxima charla con el agente arranca de cero. */
async function closeAgentConversations(session: DemoSession): Promise<void> {
  if (!session.clinic_id) return;
  await sql`
    update channel_conversations set closed_at = now()
    where clinic_id = ${session.clinic_id} and phone = ${session.phone} and closed_at is null`;
}

async function startMode(session: DemoSession, clinic: Clinic, mode: DemoMode): Promise<void> {
  await closeAgentConversations(session);
  await sql`update demo_sessions set status = ${mode}, chat_id = ${session.chat_id}, updated_at = now() where id = ${session.id}`;
  if (session.lead_id) {
    await sql`
      update leads set message = concat_ws(' · ', message, ${`Eligió: ${mode}`}::text), updated_at = now()
      where id = ${session.lead_id}`;
  }
  const agent = clinic.agent_name;
  if (mode === "chat") return void (await sendChatText(session.chat_id, DEMO_TEXTS.chat(agent, clinic.name)));
  if (mode === "audio") return void (await sendChatText(session.chat_id, DEMO_TEXTS.audio(agent, clinic.name)));

  const phoneNumberId = process.env.ELEVENLABS_PHONE_NUMBER_ID;
  const main = await getClinic();
  if (channelForChat(session.chat_id) === "whatsapp" && phoneNumberId && main.elevenlabs_agent_id) {
    if (!(await reserveDemoCall(session.id))) {
      await sendChatText(session.chat_id, DEMO_TEXTS.callLimit);
      return;
    }
    try {
      await startPhoneCall({
        agentId: main.elevenlabs_agent_id,
        phoneNumberId,
        toNumber: `+${session.phone}`,
        dynamicVariables: await demoDynamicVariables(clinic, session.phone),
      });
    } catch (e) {
      await releaseDemoCall(session.id);
      console.error("Demo: no se pudo llamar; mando el link de llamada web", e instanceof Error ? e.message : e);
      await sendCallLink(session, agent, clinic.name);
      return;
    }
    // La llamada ya salió: un fallo de WhatsApp no debe devolver la cuota ni
    // provocar que el reintento del webhook vuelva a llamar a la persona.
    await sendChatText(session.chat_id, DEMO_TEXTS.callPhone(agent, clinic.name, session.phone)).catch((e) => {
      console.error("Demo: llamada iniciada, pero no se pudo avisar por WhatsApp", e instanceof Error ? e.message : e);
    });
    return;
  }
  await sendCallLink(session, agent, clinic.name);
}

async function sendCallLink(session: DemoSession, agent: string, clinicName: string): Promise<void> {
  const token = session.call_token ?? randomBytes(18).toString("base64url");
  await sql`update demo_sessions set call_token = ${token} where id = ${session.id}`;
  await sendChatText(session.chat_id, DEMO_TEXTS.callLink(agent, clinicName, `${env.appUrl()}/probar-demo/llamada/${token}`));
}

/** Variables del agente para la clínica de la demo (llamadas por teléfono o por la web). */
export async function demoDynamicVariables(clinic: Clinic, phone: string): Promise<Record<string, string>> {
  return buildDynamicVariables(clinic, phone, { context: demoAgentContext(clinic.name, { defaultHours: !clinic.hours_text }) });
}

/** Demo y clínica del link de llamada web, si sigue vigente. */
export async function sessionForCallToken(token: string): Promise<{ session: DemoSession; clinic: Clinic } | null> {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return null;
  const [session] = await sql<DemoSession[]>`
    select * from demo_sessions
    where call_token = ${token} and status = 'llamada' and updated_at > now() - make_interval(hours => ${ACTIVE_HOURS})`;
  if (!session?.clinic_id || !(await chatIsActive(session.chat_id, session.channel_revision))) return null;
  const clinic = await demoClinic(session.clinic_id);
  return clinic ? { session, clinic } : null;
}

/** Cuota compartida por el enlace y las llamadas telefónicas de una demo. */
export async function reserveDemoCall(sessionId: string): Promise<boolean> {
  const [claimed] = await sql`
    update demo_sessions set call_attempts = call_attempts + 1
    where id = ${sessionId} and status = 'llamada' and call_attempts < 3
      and updated_at > now() - make_interval(hours => ${ACTIVE_HOURS})
    returning id`;
  return Boolean(claimed);
}

/** Un fallo antes de entregar el token o iniciar la llamada no consume la cuota. */
export async function releaseDemoCall(sessionId: string): Promise<void> {
  await sql`update demo_sessions set call_attempts = greatest(0, call_attempts - 1) where id = ${sessionId}`;
}

const WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const hoursText = (hours: DemoProfile["horarios"]) =>
  [...hours].sort((a, b) => a.dia - b.dia || a.desde.localeCompare(b.desde)).map((h) => `${WEEKDAYS[h.dia]} de ${h.desde} a ${h.hasta}`).join(", ");

const canon = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/**
 * Arma la clínica temporal: datos, profesionales, tipos de turno y horarios.
 * Cada tipo de turno tiene al menos un profesional de su especialidad, para
 * que consultar_disponibilidad siempre encuentre horarios.
 */
export async function createDemoClinic(profile: DemoProfile, website: string): Promise<Clinic>;
export async function createDemoClinic(profile: DemoProfile, website: string, session: { id: string; pages: number; site?: ScrapeResult }): Promise<Clinic | null>;
export async function createDemoClinic(profile: DemoProfile, website: string, session?: { id: string; pages: number; site?: ScrapeResult }): Promise<Clinic | null> {
  const main = await getClinic();
  const hours = profile.horarios.length ? profile.horarios : DEFAULT_HOURS;

  // Especialidades con el mismo texto en profesionales y prestaciones.
  const names = new Map<string, string>();
  const specialty = (s: string) => {
    const key = canon(s);
    if (!names.has(key)) names.set(key, s);
    return names.get(key)!;
  };
  const types = profile.prestaciones.length
    ? profile.prestaciones.map((t) => ({ ...t, especialidad: specialty(t.especialidad) }))
    : [
        { nombre: "Consulta de primera vez", especialidad: specialty(profile.especialidad), duracion_min: 30, precio: null, indicaciones: null, primera_vez: true },
        { nombre: "Control", especialidad: specialty(profile.especialidad), duracion_min: 20, precio: null, indicaciones: null, primera_vez: false },
      ];
  const pros = profile.profesionales.map((p) => ({ ...p, especialidad: specialty(p.especialidad) }));
  for (const s of new Set(types.map((t) => t.especialidad))) {
    if (!pros.some((p) => p.especialidad === s)) pros.push({ nombre: `Equipo de ${s}`, especialidad: s, dias: [], bio: null });
  }
  for (const s of new Set(pros.map((p) => p.especialidad))) {
    if (!types.some((t) => t.especialidad === s)) {
      types.push({ nombre: `Consulta de ${s}`, especialidad: s, duracion_min: 30, precio: null, indicaciones: null, primera_vez: true });
    }
  }

  const faq = [profile.descripcion, profile.preguntas_frecuentes].filter(Boolean).join("\n").trim() || null;
  return sql.begin(async (tx) => {
    if (session) {
      const [active] = await tx`select id from demo_sessions where id = ${session.id} and status = 'analizando' for update`;
      if (!active) return null;
    }
    // Las demos viejas no se acumulan: se borran con todo lo que tengan.
    await tx`delete from clinics where is_demo and retained_at is null and created_at < now() - make_interval(days => ${KEEP_DEMO_CLINICS_DAYS})`;
    const [clinic] = await tx<Clinic[]>`
      insert into clinics ${tx({
        name: profile.nombre,
        agent_name: main.agent_name,
        specialty: profile.especialidad,
        address: profile.direccion,
        phone: profile.telefono,
        website,
        timezone: main.timezone,
        hours_text: profile.horario_texto ?? (profile.horarios.length ? hoursText(profile.horarios) : null),
        accepted_coverages: profile.coberturas,
        faq,
        policies: profile.politicas,
        urgency_instructions: main.urgency_instructions,
        is_demo: true,
        demo_source_url: website,
      })}
      returning *`;
    for (const t of types) {
      await tx`
        insert into appointment_types (clinic_id, name, specialty, duration_min, instructions, price, is_first_visit)
        values (${clinic.id}, ${t.nombre}, ${t.especialidad}, ${t.duracion_min}, ${t.indicaciones}, ${t.precio}, ${t.primera_vez})`;
    }
    for (const p of pros) {
      const [pro] = await tx<{ id: string }[]>`
        insert into professionals (clinic_id, full_name, specialty, bio)
        values (${clinic.id}, ${p.nombre}, ${p.especialidad}, ${p.bio}) returning id`;
      const own = p.dias.length ? hours.filter((h) => p.dias.includes(h.dia)) : hours;
      const slots = own.length ? own : p.dias.map((dia) => ({ dia, desde: "09:00", hasta: "18:00" }));
      for (const h of slots) {
        await tx`insert into schedules (professional_id, weekday, start_time, end_time) values (${pro.id}, ${h.dia}, ${h.desde}, ${h.hasta})`;
      }
    }
    if (session?.site) await saveInitialImport(tx, clinic.id, profile, session.site);
    if (session) await tx`
      update demo_sessions set status = 'eligiendo', clinic_id = ${clinic.id}, pages_read = ${session.pages}, updated_at = now()
      where id = ${session.id}`;
    return clinic;
  });
}
