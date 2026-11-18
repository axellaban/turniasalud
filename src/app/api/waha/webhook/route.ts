import { NextResponse, after } from "next/server";
import { env } from "@/lib/env";
import { normalizePhone } from "@/lib/phone";
import { transcribeAudio } from "@/lib/elevenlabs";
import { AUDIO_FAILED_REPLY, MEDIA_ONLY_REPLY, claimEvent, forwardToAgent, releaseEvent, requestsVoiceReply, whatsappClinic } from "@/lib/channel";
import { analyzeDemo, handleDemoMessage } from "@/lib/demo/session";
import { parseOwnMessage, parseWahaEvent, verifyWahaHmac, wahaDownloadMedia, wahaPhoneForLid, wahaSendText, type WahaEvent } from "@/lib/waha";
import { handleOwnMessage } from "@/lib/waha-own";
import { sql } from "@/lib/db";

import { messagingSettings } from "@/lib/messaging-settings";
import { readPatientDocument, type DocumentRead } from "@/lib/documents";
import { currentWahaConnection } from "@/lib/waha-connections";
import { getClinic } from "@/lib/clinic";
import { phoneFromJid } from "@/lib/waha";
import { claimDocumentRead, isMuted } from "@/lib/chat-guard";
import { DOCUMENTS_LIMIT_REPLY, LONG_AUDIO_REPLY, audioTooLong } from "@/lib/chat-limits";
import { staffForPhone } from "@/lib/staff";

export const dynamic = "force-dynamic";
// La demo del lead magnet lee la web del interesado después de responder (after).
export const maxDuration = 300;

// Webhook de WAHA (WhatsApp con chip común): cada mensaje del paciente pasa al
// agente por el Custom Channel de ElevenLabs. La respuesta vuelve por
// /api/elevenlabs/canal. Configuralo en WAHA con el evento "message" y la clave HMAC.
export async function POST(request: Request) {
  const raw = await request.text();
  const own = currentWahaConnection();
  const secret = own?.webhookHmac ?? env.wahaWebhookHmac();
  if (!secret) {
    console.error("Falta WAHA_WEBHOOK_HMAC: no se pueden validar los webhooks de WAHA.");
    return NextResponse.json({ error: "Webhook sin configurar" }, { status: 500 });
  }
  if (!verifyWahaHmac(raw, request.headers.get("x-webhook-hmac"), request.headers.get("x-webhook-hmac-algorithm"), secret)) {
    return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  }

  if (own ? !own.enabled : (await messagingSettings()).active_channel !== "whatsapp") return NextResponse.json({ ignored: "canal pausado" });

  let event: WahaEvent;
  try {
    event = JSON.parse(raw) as WahaEvent;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (own && event.session !== own.session) return NextResponse.json({ ignored: "otra sesión" });
  if (own && event.me?.id && normalizePhone(phoneFromJid(event.me.id)) !== normalizePhone(own.phone)) return NextResponse.json({ ignored: "otro número" });
  // Mensaje propio de la línea de una clínica (WAHA lo avisa con `message.any`): si lo escribió el equipo
  // desde el celular, Sofi deja de contestarle a ese paciente un rato. Si la clínica no lo prendió, nada cambia.
  const mine = own ? parseOwnMessage(event) : null;
  if (own && mine) {
    try {
      const [clinic] = await sql<{ id: string; auto_pause_on_staff_reply: boolean | null }[]>`
        select id, auto_pause_on_staff_reply from clinics where id = ${own.clinicId}`;
      if (!clinic?.auto_pause_on_staff_reply) return NextResponse.json({ ignored: "mensaje propio" });
      const chatPhone = normalizePhone(phoneFromJid(mine.chatId) ?? (mine.chatId.endsWith("@lid") ? await wahaPhoneForLid(mine.chatId) : null));
      if (!chatPhone) return NextResponse.json({ ignored: "mensaje propio sin teléfono" });
      const result = await handleOwnMessage(clinic, mine, chatPhone, { linePhone: normalizePhone(own.phone) });
      if (result === "pausado") console.log(JSON.stringify({ evento: "pausa-automatica", clinica: clinic.id, motivo: "contestó el equipo desde el celular" }));
      return NextResponse.json({ ignored: "mensaje propio", pausa: result });
    } catch (e) {
      console.error("WAHA: no se pudo revisar un mensaje propio", e instanceof Error ? e.message : e);
      return NextResponse.json({ ignored: "mensaje propio" });
    }
  }
  const parsed = parseWahaEvent(event, own?.session ?? env.wahaSession());
  if (parsed.kind === "ignore") return NextResponse.json({ ignored: parsed.reason });

  const rawPhone = parsed.phone ?? (parsed.chatId.endsWith("@lid") ? await wahaPhoneForLid(parsed.chatId) : null);
  const phone = normalizePhone(rawPhone);
  if (!phone) {
    console.warn("WAHA: no se pudo saber el teléfono de un chat @lid; mensaje sin procesar.");
    return NextResponse.json({ ignored: "sin teléfono" });
  }

  // Un número en silencio (bot, vendedor o exceso de mensajes) no gasta nada: ni audio, ni foto, ni Sofi.
  // En la línea general se mira la clínica que la atiende; las demos se frenan después, en forwardToAgent.
  const lineClinicId = own?.clinicId ?? (await whatsappClinic()).id;
  if (await isMuted(lineClinicId, phone)) return NextResponse.json({ ignored: "número en silencio" });
  const staff = Boolean(await staffForPhone(lineClinicId, phone));

  const key = own ? `in:${own.id}:${parsed.id}` : `in:${parsed.id}`;
  if (!(await claimEvent(key))) return NextResponse.json({ duplicate: true });

  try {
    let text = parsed.text;
    let document: DocumentRead | null = null;
    if (parsed.audio) {
      const audio = await wahaDownloadMedia(parsed.audio.url);
      if (audio && audioTooLong(parsed.audio.seconds, new Uint8Array(await audio.arrayBuffer()))) {
        await wahaSendText(parsed.chatId, LONG_AUDIO_REPLY);
        return NextResponse.json({ ok: true, audio: "muy_largo" });
      }
      const heard = audio ? await transcribeAudio(audio, parsed.audio.mimetype).catch((e) => {
        console.error("No se pudo transcribir el audio", e instanceof Error ? e.message : e);
        return "";
      }) : "";
      if (!heard) {
        await wahaSendText(parsed.chatId, AUDIO_FAILED_REPLY);
        return NextResponse.json({ ok: true, audio: "sin_transcripcion" });
      }
      text = `${text ? `${text}\n` : ""}(audio) ${heard}`;
    }
    if (parsed.otherMedia) {
      if (!staff && !(await claimDocumentRead(lineClinicId, phone))) {
        await wahaSendText(parsed.chatId, DOCUMENTS_LIMIT_REPLY);
        return NextResponse.json({ ok: true, media: "tope_del_dia" });
      }
      // Fotos y PDF (credencial, orden, receta): Claude los lee y el agente recibe lo que dicen.
      const file = parsed.media ? await wahaDownloadMedia(parsed.media.url) : null;
      document = file ? await readPatientDocument(file, parsed.media!.mimetype, text) : null;
      if (document) text = document.text;
      else if (!text) {
        await wahaSendText(parsed.chatId, MEDIA_ONLY_REPLY);
        return NextResponse.json({ ok: true, media: "no_soportada" });
      } else text += "\n(El paciente mandó además una foto o archivo que no podés ver: pedile que te lo cuente por escrito.)";
    }

    // Lead magnet: "quiero probar la demo, mi web es…" y lo que siga de esa demo.
    const demo = own ? null : await handleDemoMessage({ messageId: parsed.id, chatId: parsed.chatId, phone, text });
    if (demo) {
      const sessionId = demo.analyze;
      if (sessionId) after(() => analyzeDemo(sessionId));
      return NextResponse.json({ ok: true, demo: demo.status });
    }

    const clinic = own ? await getClinic(own.clinicId) : await whatsappClinic();
    // La foto queda en la ficha del paciente; si no se puede guardar, el agente igual la recibe.
    await document?.save({ clinicId: clinic.id, phone, channel: "whatsapp" }).catch((e) => console.error("WAHA: no se pudo guardar la foto", e instanceof Error ? e.message : e));
    const res = await forwardToAgent(clinic, { messageId: parsed.id, chatId: parsed.chatId, phone, text }, {
      // Nota de voz si habló por audio, o si la pidió en una línea propia con voz configurada.
      voiceForMessage: Boolean(parsed.audio) || Boolean(own && clinic.elevenlabs_voice_id && !parsed.otherMedia && requestsVoiceReply(text)),
    });
    return NextResponse.json({ ok: true, conversation_id: res.conversation_id, continued: res.continued, ...(res.blocked && { limite: res.blocked }) });
  } catch (e) {
    // Sin marcar como procesado: si WAHA reintenta, se vuelve a intentar.
    await releaseEvent(key);
    console.error("WAHA: no se pudo pasar el mensaje al agente", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "No se pudo procesar el mensaje" }, { status: 502 });
  }
}
