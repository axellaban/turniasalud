import { z } from "zod";
import { AXEL_WHATSAPP } from "@/lib/sales/contacto-axel";
import { CHAPA_PROSPECTING_ORIGIN } from "@/lib/sales/chapa-voice";
import { OutreachError } from "@/lib/sales/outreach";
import {
  importSenderChats,
  listVoiceNotes,
  saveBrowserVoiceNote,
  sendVoiceTest,
  sendVoiceToProspect,
  setVoiceSender,
  syncVoiceSendersFromWaha,
  voiceCandidates,
  voiceChannelStatus,
  voiceNoteAudio,
  voiceSentToday,
  voiceSenderPhones,
  VOICE_DAILY_LIMIT,
  VOICE_GROUPS,
  VOICE_MAX_BYTES,
} from "@/lib/sales/voice-outreach";
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
const secondsSchema = z.number().min(1).max(180).default(15);
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("source"), person: z.uuid(), sender: z.string().regex(/^\d{4}$/), confirmed: z.boolean() }),
  z.object({ action: z.literal("detect") }),
  z.object({ action: z.literal("import"), sender: z.string().regex(/^\d{4}$/), phones: z.array(z.string().max(40)).min(1).max(20000) }),
  z.object({ action: z.literal("test"), note: noteSchema, seconds: secondsSchema }),
  z.object({ action: z.literal("send"), note: noteSchema, person: z.uuid(), group: groupSchema, text: z.string().max(500), seconds: secondsSchema }),
]);

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
  const [notes, people, status, used] = await Promise.all([
    listVoiceNotes(),
    voiceCandidates(group.data, note.success ? note.data : null),
    voiceChannelStatus(),
    voiceSentToday(),
  ]);
  return json({
    ready: status.configured && status.ok,
    sender: status.configured && status.ok ? status.me?.slice(-4) : null,
    testTo: AXEL_WHATSAPP.slice(-4),
    senderOptions: voiceSenderPhones().map((phone) => phone.slice(-4)),
    notes: notes.map(({ id, label }) => ({ id, label })),
    people: people.map(({ id, name, business_name, phone, sent, senders }) => ({ id, name, practice: business_name, last4: phone?.slice(-4), sent, senders: senders.map((number) => number.slice(-4)) })),
    remaining: Math.max(0, VOICE_DAILY_LIMIT - used),
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
      return json({ id: await saveBrowserVoiceNote(label, Buffer.from(await file.arrayBuffer())) }, 201);
    }

    const input = actionSchema.safeParse(await request.json().catch(() => null));
    if (!input.success) return json({ error: "Revisá el audio, el destino y la etapa." }, 400);
    const { data } = input;
    if (data.action === "source") {
      await setVoiceSender(data.person, data.sender, data.confirmed);
      return json({ ok: true });
    }
    if (data.action === "detect") return json(await syncVoiceSendersFromWaha());
    if (data.action === "import") return json(await importSenderChats(data.sender, data.phones));
    if (data.action === "test") {
      await sendVoiceTest(data.note, AXEL_WHATSAPP, "", data.seconds);
      return json({ ok: true });
    }
    await sendVoiceToProspect(data.note, data.person, data.text, data.seconds, data.group);
    queueTurniaSheetSync();
    return json({ ok: true });
  } catch (error) {
    if (error instanceof OutreachError) return json({ error: error.message }, 422);
    console.error("chapa_prospecting_voice", error instanceof Error ? error.message : error);
    return json({ error: "No se pudo completar la operación." }, 500);
  }
}
