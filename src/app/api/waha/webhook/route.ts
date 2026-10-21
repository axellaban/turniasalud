import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { normalizePhone } from "@/lib/phone";
import { transcribeAudio } from "@/lib/elevenlabs";
import { AUDIO_FAILED_REPLY, MEDIA_ONLY_REPLY, claimEvent, forwardToAgent, releaseEvent, whatsappClinic } from "@/lib/channel";
import { parseWahaEvent, verifyWahaHmac, wahaDownloadMedia, wahaPhoneForLid, wahaSendText, type WahaEvent } from "@/lib/waha";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Webhook de WAHA (WhatsApp con chip común): cada mensaje del paciente pasa al
// agente por el Custom Channel de ElevenLabs. La respuesta vuelve por
// /api/elevenlabs/canal. Configuralo en WAHA con el evento "message" y la clave HMAC.
export async function POST(request: Request) {
  const raw = await request.text();
  const secret = env.wahaWebhookHmac();
  if (!secret) {
    console.error("Falta WAHA_WEBHOOK_HMAC: no se pueden validar los webhooks de WAHA.");
    return NextResponse.json({ error: "Webhook sin configurar" }, { status: 500 });
  }
  if (!verifyWahaHmac(raw, request.headers.get("x-webhook-hmac"), request.headers.get("x-webhook-hmac-algorithm"), secret)) {
    return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  }

  let event: WahaEvent;
  try {
    event = JSON.parse(raw) as WahaEvent;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const parsed = parseWahaEvent(event, env.wahaSession());
  if (parsed.kind === "ignore") return NextResponse.json({ ignored: parsed.reason });

  const rawPhone = parsed.phone ?? (parsed.chatId.endsWith("@lid") ? await wahaPhoneForLid(parsed.chatId) : null);
  const phone = normalizePhone(rawPhone);
  if (!phone) {
    console.warn("WAHA: no se pudo saber el teléfono de un chat @lid; mensaje sin procesar.");
    return NextResponse.json({ ignored: "sin teléfono" });
  }

  const key = `in:${parsed.id}`;
  if (!(await claimEvent(key))) return NextResponse.json({ duplicate: true });

  try {
    let text = parsed.text;
    if (parsed.audio) {
      const audio = await wahaDownloadMedia(parsed.audio.url);
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
      if (!text) {
        await wahaSendText(parsed.chatId, MEDIA_ONLY_REPLY);
        return NextResponse.json({ ok: true, media: "no_soportada" });
      }
      text += "\n(El paciente mandó además una foto o archivo que no podés ver: pedile que te lo cuente por escrito.)";
    }

    const clinic = await whatsappClinic();
    const res = await forwardToAgent(clinic, { messageId: parsed.id, chatId: parsed.chatId, phone, text });
    return NextResponse.json({ ok: true, conversation_id: res.conversation_id, continued: res.continued });
  } catch (e) {
    // Sin marcar como procesado: si WAHA reintenta, se vuelve a intentar.
    await releaseEvent(key);
    console.error("WAHA: no se pudo pasar el mensaje al agente", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "No se pudo procesar el mensaje" }, { status: 502 });
  }
}
