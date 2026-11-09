import { z } from "zod";
import { AXEL_WHATSAPP } from "@/lib/sales/contacto-axel";
import { CHAPA_PROSPECTING_ORIGIN } from "@/lib/sales/chapa-voice";
import { OutreachError, outreachSettings } from "@/lib/sales/outreach";
import { TEMPLATE_LABEL } from "@/lib/sales/outreach-messages";
import {
  listVoiceNotes,
  saveBrowserVoiceNote,
  sendVoiceTest,
  sendVoiceToProspect,
  setVoiceSender,
  suggestVoiceSendersFromWaha,
  voiceCandidates,
  voiceChannelStatus,
  voiceNoteAudio,
  voiceSentToday,
  voiceSenderPhones,
  VoicePaceError,
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

export const maxDuration = 120;

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
  const [notes, people, status, used, rules, settings] = await Promise.all([
    listVoiceNotes(),
    voiceCandidates(group.data, note.success ? note.data : null),
    voiceChannelStatus(sender.data),
    voiceSentToday(),
    voiceRules(),
    outreachSettings(),
  ]);
  return json({
    ready: status.configured && status.ok,
    sender: status.configured && status.ok ? status.me?.slice(-4) : null,
    testTo: testPhone(sender.data)?.slice(-4) ?? null,
    senderOptions: voiceSenderPhones().map((phone) => phone.slice(-4)),
    notes: notes.map(({ id, label }) => ({ id, label })),
    people: people.map(({ id, name, business_name, phone, sent, needs_review, senders }) => ({ id, name, practice: business_name, last4: phone?.slice(-4), sent, needsReview: needs_review, senders: senders.map((number) => number.slice(-4)) })),
    stage: {
      textOnly: voiceTextOnly(group.data),
      needsSender: voiceNeedsSender(group.data),
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
    if (error instanceof OutreachError) return json({ error: error.message }, 422);
    console.error("chapa_prospecting_voice", error instanceof Error ? error.message : error);
    return json({ error: "No se pudo completar la operación." }, 500);
  }
}
