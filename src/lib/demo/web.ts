import "server-only";
import { randomBytes } from "node:crypto";
import { sql } from "../db";
import { getClinic } from "../clinic";
import { getChatCredential, getConversationToken } from "../elevenlabs";
import { messagingSettings } from "../messaging-settings";
import { notifyN8n } from "../n8n";
import type { Clinic } from "../types";
import { hostOf } from "./flow";
import type { ManualClinic } from "./website";
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

/** website: la web leída ("" sin web). nombre: el consultorio de una demo sin web. */
export type WebDemoState =
  | { status: "analizando"; website: string; nombre?: string }
  | { status: "error"; website: string; nombre?: string }
  | { status: "terminada"; website: string; nombre?: string }
  | {
      status: "lista";
      website: string;
      nombre?: string;
      clinic: { name: string; agentName: string; specialty: string; address: string | null; professionals: string[]; types: string[] };
      remaining: number;
    };

/**
 * Crea la demo y su interesado. Devuelve el token de la página y el id de la
 * sesión, que hay que analizar después de responder. null: superó el límite.
 * Con web se lee la web; sin web (manual) la ficha sale del nombre del consultorio.
 */
export async function startWebDemo(input: {
  website: string | null;
  manual: ManualClinic | null;
  email: string | null;
  ip: string;
  /** La persona de PostHog del navegador que la pidió (opcional). */
  analyticsId?: string | null;
}): Promise<{ token: string; sessionId: string; leadId: string } | null> {
  const manual = input.website ? null : input.manual;
  if (!input.website && !manual) return null;
  const label = input.website ? hostOf(input.website) : manual!.nombre;
  // El mismo freno contra abusos que el paso a Telegram (por origen y total por hora).
  const handoff = await createDemoHandoff(input.website ?? `sin web: ${label}`, input.ip, input.email);
  if (!handoff) return null;
  const settings = await messagingSettings();
  const id = `web:${randomBytes(9).toString("base64url")}`;
  const token = `w_${randomBytes(18).toString("base64url")}`;
  const note = input.website
    ? `Probó la demo en el navegador con su web: ${input.website}`
    : `Probó la demo en el navegador sin web: ${label}${manual!.direccion ? ` (${manual!.direccion})` : ""}`;
  const result = await sql.begin(async (tx) => {
    // Sin email, el interesado es su web o el nombre de su consultorio.
    const key = input.email ?? label.toLowerCase();
    await tx`select pg_advisory_xact_lock(hashtextextended(${`turnia-demo:${key}`}, 0))`;
    // Un interesado es un solo pedido en el panel, aunque pruebe varias veces.
    const [previous] = await tx<{ id: string }[]>`
      select l.id from leads l
      where l.source = 'demo-web' and ${input.email
        ? tx`l.email = ${input.email}`
        : tx`exists (select 1 from demo_sessions ds where ds.lead_id = l.id and ds.chat_id like 'web:%' and ${
            input.website ? tx`ds.website = ${input.website}` : tx`lower(ds.manual_name) = ${label.toLowerCase()}`
          })`}
      order by l.created_at desc limit 1`;
    if (settings.demo_daily_limit && previous) {
      const [{ count }] = await tx<{ count: number }[]>`
        select count(*)::int as count from demo_sessions
        where lead_id = ${previous.id} and chat_id like 'web:%' and created_at > now() - interval '1 day'`;
      if (count >= settings.demo_daily_limit) return null;
    }
    const [existing] = previous
      ? await tx<{ id: string }[]>`
          update leads set message = concat_ws(' · ', message, ${note}::text), email = coalesce(email, ${input.email}), updated_at = now()
          where id = ${previous.id} returning id`
      : [];
    const lead = existing ?? (await tx<{ id: string }[]>`
      insert into leads (name, email, organization, message, source)
      values (${label}, ${input.email}, ${label}, ${note}, 'demo-web')
      returning id`)[0];
    const [session] = await tx<{ id: string }[]>`
      insert into demo_sessions (phone, chat_id, website, lead_id, request_message_id, call_token, channel_revision, manual_name, manual_address, manual_specialty, manual_professional, manual_services, analytics_id)
      values (${id}, ${id}, ${input.website ?? ""}, ${lead.id}, ${handoff}, ${token}, ${settings.revision},
              ${manual?.nombre ?? null}, ${manual?.direccion ?? null}, ${manual?.especialidad ?? null}, ${manual?.profesional ?? null}, ${manual?.servicios ?? null},
              ${input.analyticsId ?? null})
      returning id`;
    return { sessionId: session.id, leadId: lead.id, createdLead: !existing };
  });
  if (!result) return null;
  if (result.createdLead) {
    await notifyN8n("lead.nuevo", {
      // Misma forma que el formulario de /pedi-una-demo, para que el aviso de n8n lo muestre igual.
      lead: { id: result.leadId, nombre: label, email: input.email, telefono: null, organizacion: label, mensaje: note, origen: "demo-web", web: input.website },
    });
  }
  return { token, sessionId: result.sessionId, leadId: result.leadId };
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
  const sinWeb = session.manual_name ? { nombre: session.manual_name } : {};
  if (session.status === "analizando") return { status: "analizando", website, ...sinWeb };
  if (session.status === "error") return { status: "error", website, ...sinWeb };
  if (session.status === "terminada") return { status: "terminada", website, ...sinWeb };
  const clinic = await demoClinic(session.clinic_id);
  if (!clinic) return { status: "error", website, ...sinWeb };
  const [professionals, types, [quota]] = await Promise.all([
    sql<{ full_name: string }[]>`select full_name from professionals where clinic_id = ${clinic.id} and active order by full_name limit 8`,
    sql<{ name: string }[]>`select name from appointment_types where clinic_id = ${clinic.id} and active order by name limit 8`,
    sql<{ used: number }[]>`select call_attempts as used from demo_sessions where id = ${session.id}`,
  ]);
  return {
    status: "lista",
    website,
    ...sinWeb,
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
      mode === "chat" ? getChatCredential(main.elevenlabs_agent_id) : getConversationToken(main.elevenlabs_agent_id),
      demoDynamicVariables(clinic, session.phone),
    ]);
    return {
      ...(typeof credential === "string" ? { token: credential } : credential),
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
