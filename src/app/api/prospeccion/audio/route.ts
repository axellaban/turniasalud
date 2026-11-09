import { z } from "zod";
import { AXEL_WHATSAPP } from "@/lib/sales/contacto-axel";
import { CHAPA_PROSPECTING_ORIGIN } from "@/lib/sales/chapa-voice";
import { OutreachError, outreachSettings } from "@/lib/sales/outreach";
import { TEMPLATE_LABEL } from "@/lib/sales/outreach-messages";
import { syncWhatsappReplies } from "@/lib/sales/whatsapp-sync";
import {
  forbidsLink,
  listVoiceNotes,
  needsLink,
  reconnectVoiceBusiness,
  saveBrowserVoiceNote,
  sendVoiceTest,
  sendVoiceToProspect,
  setVoiceSender,
  suggestVoiceSendersFromWaha,
  voiceCandidates,
  voiceBusinessConnection,
  voiceChannelStatus,
  voiceNoteAudio,
  voiceUsageToday,
  voiceSenderPhones,
  VoicePaceError,
  VoiceRecipientIneligibleError,
  VoiceRecipientUnavailableError,
  VOICE_DEFAULT_TEXT,
  VOICE_GROUPS,
  VOICE_MAX_BYTES,
  VOICE_PANEL_TEMPLATES,
  voiceNeedsSender,
  voiceTextOnly,
} from "@/lib/sales/voice-outreach";
import { saveVoiceRules, voiceRules, voiceRulesSchema } from "@/lib/sales/voice-rules";
import { verifyProspectingVoiceToken } from "@/lib/session";
import { queueTurniaSheetSync } from "@/lib/sheets/turnia-sheet";

// «Leer las respuestas» recorre los chats de las dos líneas (hasta dos minutos y medio).
export const maxDuration = 300;

const headers = {
  "Access-Control-Allow-Origin": CHAPA_PROSPECTING_ORIGIN,
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Cache-Control": "private, no-store",
  Vary: "Origin",
};
const groupSchema = z.enum(VOICE_GROUPS);
const noteSchema = z.uuid();
const senderSchema = z.string().regex(/^\d{4}$/).optional();
const secondsSchema = z.number().min(1).max(180).default(15);
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("rules"), rules: voiceRulesSchema }),
  z.object({ action: z.literal("reconnect"), relink: z.boolean() }),
  // Lee los chats de las dos líneas (lo mismo que «Leer WhatsApp ahora»): así el Paso 2 y el 3 ven quién respondió.
  z.object({ action: z.literal("sync") }),
  z.object({ action: z.literal("source"), person: z.uuid(), sender: z.string().regex(/^\d{4}$/), confirmed: z.boolean() }),
  z.object({ action: z.literal("detect"), sender: senderSchema }),
  // Sin `note` sale solo el texto.
  z.object({ action: z.literal("test"), note: noteSchema.nullish(), text: z.string().max(500).default(""), seconds: secondsSchema, sender: senderSchema }),
  z.object({ action: z.literal("send"), note: noteSchema.nullish(), person: z.uuid(), group: groupSchema, text: z.string().max(500), seconds: secondsSchema, sender: senderSchema }),
]);

const testPhone = (sender?: string) => sender === AXEL_WHATSAPP.slice(-4)
  ? voiceSenderPhones().find((phone) => phone !== AXEL_WHATSAPP)
  : AXEL_WHATSAPP;

const json = (data: unknown, status = 200) => Response.json(data, { status, headers });
const allowed = (request: Request) => request.headers.get("origin") === CHAPA_PROSPECTING_ORIGIN;
const authorized = (request: Request) => allowed(request) && verifyProspectingVoiceToken(
  request.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1] ?? null,
);

export function OPTIONS(request: Request) {
  return new Response(null, { status: allowed(request) ? 204 : 403, headers });
}

export async function GET(request: Request) {
  if (!authorized(request)) return json({ error: "Autorizá los audios con tu sesión de Turnia." }, 401);
  const params = new URL(request.url).searchParams;
  if (params.get("view") === "connection") return json(await voiceBusinessConnection());
  const note = noteSchema.safeParse(params.get("note"));
  if (params.get("view") === "recording") {
    const recording = note.success ? await voiceNoteAudio(note.data) : null;
    return recording
      ? new Response(new Uint8Array(recording.audio), {
          headers: { ...headers, "Content-Type": recording.mimetype, "X-Content-Type-Options": "nosniff" },
        })
      : json({ error: "No encontramos ese audio." }, 404);
  }

  const group = groupSchema.safeParse(params.get("group"));
  if (!group.success) return json({ error: "Elegí una etapa." }, 400);
  const sender = senderSchema.safeParse(params.get("sender") ?? undefined);
  if (!sender.success) return json({ error: "Elegí una línea de WhatsApp." }, 400);
  const [notes, people, status, usage, rules, settings] = await Promise.all([
    listVoiceNotes(),
    voiceCandidates(group.data, note.success ? note.data : null, true),
    voiceChannelStatus(sender.data),
    voiceUsageToday(),
    voiceRules(),
    outreachSettings(),
  ]);
  const used = usage.reduce((sum, line) => sum + line.used, 0);
  const senderOptions = voiceSenderPhones().map((phone) => phone.slice(-4));
  const endings = [...new Set([...senderOptions, ...usage.flatMap((line) => line.ending ? [line.ending] : [])])];
  return json({
    ready: status.configured && status.ok,
    channelStatus: status.configured ? status.status : "CONFIG",
    sender: status.configured && status.ok ? status.me?.slice(-4) : null,
    testTo: testPhone(sender.data)?.slice(-4) ?? null,
    senderOptions,
    sentToday: {
      byLine: endings.map((ending) => ({ ending, sent: usage.find((line) => line.ending === ending)?.sent ?? 0 })),
      withoutSender: usage.find((line) => line.ending === null)?.sent ?? 0,
    },
    notes: notes.map(({ id, label }) => ({ id, label })),
    people: people.map(({ id, name, business_name, phone, sent, needs_review, senders, reply, reply_at, whatsapp_unavailable }) => ({
      id, name, practice: business_name, last4: phone?.slice(-4), sent, needsReview: needs_review, senders: senders.map((number) => number.slice(-4)),
      whatsappUnavailable: whatsapp_unavailable,
      reply: reply?.slice(0, 160) ?? null, replyAt: reply_at,
    })),
    stage: {
      textOnly: voiceTextOnly(group.data),
      needsSender: voiceNeedsSender(group.data),
      link: needsLink(group.data) ? "required" : forbidsLink(group.data) ? "forbidden" : "optional",
      defaultText: VOICE_DEFAULT_TEXT[group.data],
      panelTemplates: VOICE_PANEL_TEMPLATES[group.data].map((key) => ({ label: TEMPLATE_LABEL[key].title, text: settings.templates[key] })),
    },
    remaining: Math.max(0, rules.dailyLimit - used),
    used,
    rules,
  });
}

export async function POST(request: Request) {
  if (!authorized(request)) return json({ error: "Autorizá los audios con tu sesión de Turnia." }, 401);
  try {
    if (request.headers.get("content-type")?.startsWith("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("audio");
      const label = form.get("label");
      if (typeof label !== "string" || !(file instanceof File) || !file.size || file.size > VOICE_MAX_BYTES) {
        return json({ error: "Elegí un audio de hasta 3 MB y ponéle un nombre." }, 400);
      }
      const sender = senderSchema.safeParse(form.get("sender") ?? undefined);
      if (!sender.success) return json({ error: "Elegí una línea de WhatsApp." }, 400);
      return json({ id: await saveBrowserVoiceNote(label, Buffer.from(await file.arrayBuffer()), sender.data) }, 201);
    }

    const body = await request.json().catch(() => null);
    const input = actionSchema.safeParse(body);
    if (!input.success) return json({
      error: body?.action === "rules" ? input.error.issues[0]?.message ?? "Revisá las reglas de envío." : "Revisá el audio o el mensaje, el destino y la etapa.",
    }, 400);
    const { data } = input;
    if (data.action === "rules") return json({ rules: await saveVoiceRules(data.rules) });
    if (data.action === "sync") {
      try {
        const report = await syncWhatsappReplies("Audios y mensajes (Chapa)");
        return json({ at: report.at, reused: Boolean(report.reused), nuevas: report.totals.nuevas, lines: report.lines });
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : "No se pudieron leer los chats." }, 409);
      }
    }
    if (data.action === "reconnect") {
      await reconnectVoiceBusiness(data.relink);
      return json({ ok: true });
    }
    if (data.action === "source") {
      await setVoiceSender(data.person, data.sender, data.confirmed);
      return json({ ok: true });
    }
    if (data.action === "detect") return json(await suggestVoiceSendersFromWaha(data.sender));
    if (data.action === "test") {
      const phone = testPhone(data.sender);
      if (!phone) return json({ error: "Falta el otro WhatsApp para recibir la prueba." }, 422);
      await sendVoiceTest(data.note ?? null, phone, data.text, data.seconds, data.sender);
      return json({ ok: true });
    }
    await sendVoiceToProspect(data.note ?? null, data.person, data.text, data.seconds, data.group, data.sender);
    queueTurniaSheetSync();
    return json({ ok: true });
  } catch (error) {
    if (error instanceof VoicePaceError) return json({ error: error.message, retryAfter: error.retryAfter }, 429);
    if (error instanceof VoiceRecipientIneligibleError) return json({ error: error.message, code: "recipient_ineligible" }, 422);
    if (error instanceof VoiceRecipientUnavailableError) return json({ error: error.message, code: "recipient_unavailable" }, 422);
    if (error instanceof OutreachError) return json({ error: error.message }, 422);
    console.error("chapa_prospecting_voice", error instanceof Error ? error.message : error);
    return json({ error: "No se pudo completar la operación." }, 500);
  }
}
