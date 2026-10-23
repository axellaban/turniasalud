import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { verifyWebhookSignature } from "@/lib/elevenlabs";
import { handleReply, type ChannelReply } from "@/lib/channel";

export const dynamic = "force-dynamic";

// Respuestas del agente por el Custom Channel de ElevenLabs (WhatsApp por WAHA).
// Es la "Reply Webhook URL" del trigger. ElevenLabs reintenta a los 0, 0,5 y
// 2 segundos si no respondemos 2xx; los reintentos no duplican el mensaje.
export async function POST(request: Request) {
  const raw = await request.text();
  const secret = env.channelSigningSecret();
  if (!secret) {
    console.error("Falta ELEVENLABS_CHANNEL_SIGNING_SECRET: no se pueden validar las respuestas del agente.");
    return NextResponse.json({ error: "Webhook sin configurar" }, { status: 500 });
  }
  if (!verifyWebhookSignature(raw, request.headers.get("elevenlabs-signature"), secret)) {
    return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  }

  let reply: ChannelReply;
  try {
    reply = JSON.parse(raw) as ChannelReply;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (!reply.conversation_id) return NextResponse.json({ error: "Falta conversation_id" }, { status: 400 });

  const outcome = await handleReply(reply);
  if (outcome.status === "unknown_conversation") {
    return NextResponse.json({ error: "Conversación todavía no registrada" }, { status: 409 });
  }
  if (outcome.status === "send_failed") {
    console.error("Canal: no se pudo mandar la respuesta del agente", outcome.error);
    return NextResponse.json({ error: "No se pudo enviar al canal activo" }, { status: 502 });
  }
  return NextResponse.json({ received: true, ...outcome });
}
