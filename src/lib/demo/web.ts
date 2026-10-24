import "server-only";
import { randomBytes } from "node:crypto";
import { sql } from "../db";
import { getClinic } from "../clinic";
import { getConversationToken, getSignedUrl } from "../elevenlabs";
import { messagingSettings } from "../messaging-settings";
import { notifyN8n } from "../n8n";
import type { Clinic } from "../types";
import { hostOf } from "./flow";
import { createDemoHandoff } from "./handoff";
import { demoDynamicVariables, type DemoSession } from "./session";

// Demo en el navegador (/probar-demo → /probar-demo/sesion/<token>): la misma
// lectura de la web y la misma clínica temporal que por Telegram o WhatsApp,
// pero el interesado chatea o habla con el agente sin salir de la página.

/** Una demo del navegador sigue abierta este lapso desde su último uso. */
const ACTIVE_HOURS = 24;
/** Conversaciones (chat o voz) por demo: cada una consume créditos de ElevenLabs. */
const MAX_CONVERSATIONS = 6;
const TOKEN = /^w_[A-Za-z0-9_-]{24}$/;

export type WebDemoMode = "chat" | "voz";

export type WebDemoState =
  | { status: "analizando"; website: string }
  | { status: "error"; website: string }
  | { status: "terminada"; website: string }
  | {
      status: "lista";
      website: string;
      clinic: { name: string; agentName: string; specialty: string; address: string | null; professionals: string[]; types: string[] };
      remaining: number;
    };

/**
 * Crea la demo y su interesado. Devuelve el token de la página y el id de la
 * sesión, que hay que analizar después de responder. null: superó el límite.
 */
export async function startWebDemo(input: { website: string; email: string; ip: string }): Promise<{ token: string; sessionId: string } | null> {
  // El mismo freno contra abusos que el paso a Telegram (por origen y total por hora).
  const handoff = await createDemoHandoff(input.website, input.ip, input.email);
  if (!handoff) return null;
  const settings = await messagingSettings();
  const id = `web:${randomBytes(9).toString("base64url")}`;
  const token = `w_${randomBytes(18).toString("base64url")}`;
  const note = `Probó la demo en el navegador con su web: ${input.website}`;
  const result = await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${`turnia-demo:${input.email}`}, 0))`;
    if (settings.demo_daily_limit) {
      const [{ count }] = await tx<{ count: number }[]>`
        select count(*)::int as count from demo_sessions ds join leads l on l.id = ds.lead_id
        where l.email = ${input.email} and ds.chat_id like 'web:%' and ds.created_at > now() - interval '1 day'`;
      if (count >= settings.demo_daily_limit) return null;
    }
    // Un interesado es un solo pedido en el panel, aunque pruebe varias webs.
    const [existing] = await tx<{ id: string }[]>`
      update leads set message = concat_ws(' · ', message, ${note}::text), updated_at = now()
      where id = (select id from leads where email = ${input.email} and source = 'demo-web' order by created_at desc limit 1)
      returning id`;
    const lead = existing ?? (await tx<{ id: string }[]>`
      insert into leads (name, email, organization, message, source)
      values (${input.email}, ${input.email}, ${hostOf(input.website)}, ${note}, 'demo-web')
      returning id`)[0];
    const [session] = await tx<{ id: string }[]>`
      insert into demo_sessions (phone, chat_id, website, lead_id, request_message_id, call_token, channel_revision)
      values (${id}, ${id}, ${input.website}, ${lead.id}, ${handoff}, ${token}, ${settings.revision})
      returning id`;
    return { sessionId: session.id, leadId: lead.id, createdLead: !existing };
  });
  if (!result) return null;
  if (result.createdLead) {
    await notifyN8n("lead.nuevo", {
      // Misma forma que el formulario de /pedi-una-demo, para que el aviso de n8n lo muestre igual.
      lead: { id: result.leadId, nombre: input.email, email: input.email, telefono: null, organizacion: hostOf(input.website), mensaje: note, origen: "demo-web", web: input.website },
    });
  }
  return { token, sessionId: result.sessionId };
}

async function sessionForToken(token: string): Promise<DemoSession | null> {
  if (!TOKEN.test(token)) return null;
  const [session] = await sql<DemoSession[]>`
    select * from demo_sessions
    where call_token = ${token} and chat_id like 'web:%' and updated_at > now() - make_interval(hours => ${ACTIVE_HOURS})`;
  return session ?? null;
}

async function demoClinic(id: string | null): Promise<Clinic | null> {
  if (!id) return null;
  const [clinic] = await sql<Clinic[]>`select * from clinics where id = ${id} and is_demo`;
  return clinic ?? null;
}

/** Lo que muestra la página de la demo mientras se lee la web y cuando ya está lista. */
export async function webDemoState(token: string): Promise<WebDemoState | null> {
  const session = await sessionForToken(token);
  if (!session) return null;
  const website = session.website;
  if (session.status === "analizando") return { status: "analizando", website };
  if (session.status === "error") return { status: "error", website };
  if (session.status === "terminada") return { status: "terminada", website };
  const clinic = await demoClinic(session.clinic_id);
  if (!clinic) return { status: "error", website };
  const [professionals, types, [quota]] = await Promise.all([
    sql<{ full_name: string }[]>`select full_name from professionals where clinic_id = ${clinic.id} and active order by full_name limit 8`,
    sql<{ name: string }[]>`select name from appointment_types where clinic_id = ${clinic.id} and active order by name limit 8`,
    sql<{ used: number }[]>`select call_attempts as used from demo_sessions where id = ${session.id}`,
  ]);
  return {
    status: "lista",
    website,
    clinic: {
      name: clinic.name,
      agentName: clinic.agent_name,
      specialty: clinic.specialty,
      address: clinic.address,
      professionals: professionals.map((p) => p.full_name),
      types: types.map((t) => t.name),
    },
    remaining: Math.max(0, MAX_CONVERSATIONS - quota.used),
  };
}

export class WebDemoError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Credencial de ElevenLabs para chatear o hablar con el agente de la clínica de la demo. */
export async function startWebConversation(token: string, mode: WebDemoMode) {
  const session = await sessionForToken(token);
  const clinic = session && session.status !== "analizando" && session.status !== "error" && session.status !== "terminada"
    ? await demoClinic(session.clinic_id)
    : null;
  if (!session || !clinic) throw new WebDemoError("Esta demo ya no está disponible. Volvé a /probar-demo para armar otra.", 404);
  const main = await getClinic();
  if (!main.elevenlabs_agent_id) throw new WebDemoError("La demo todavía no está disponible. Probá en un rato.", 409);
  const status = mode === "voz" ? "llamada" : "chat";
  const [claimed] = await sql<{ lead_id: string | null }[]>`
    update demo_sessions set call_attempts = call_attempts + 1, status = ${status}, updated_at = now()
    where id = ${session.id} and call_attempts < ${MAX_CONVERSATIONS}
    returning lead_id`;
  if (!claimed) throw new WebDemoError(`Ya usaste las ${MAX_CONVERSATIONS} conversaciones de esta demo. Si querés seguir, pedí una demo guiada.`, 429);
  if (claimed.lead_id) {
    await sql`update leads set message = concat_ws(' · ', message, ${`Eligió: ${mode === "voz" ? "voz" : "chat"} en el navegador`}::text), updated_at = now() where id = ${claimed.lead_id}`;
  }
  try {
    // Una conversación nueva arranca de cero, como al cambiar de modo por chat.
    await sql`update channel_conversations set closed_at = now() where clinic_id = ${clinic.id} and phone = ${session.phone} and closed_at is null`;
    const [credential, dynamicVariables] = await Promise.all([
      mode === "chat" ? getSignedUrl(main.elevenlabs_agent_id) : getConversationToken(main.elevenlabs_agent_id),
      demoDynamicVariables(clinic, session.phone),
    ]);
    return {
      ...(mode === "chat" ? { signedUrl: credential } : { token: credential }),
      dynamicVariables,
      userId: session.phone,
      clinicName: clinic.name,
      agentName: clinic.agent_name,
    };
  } catch (e) {
    await sql`update demo_sessions set call_attempts = greatest(0, call_attempts - 1) where id = ${session.id}`;
    throw e;
  }
}
