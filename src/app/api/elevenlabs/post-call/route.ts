import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { verifyWebhookSignature } from "@/lib/elevenlabs";
import { recordConversation, type PostCallPayload } from "@/lib/conversations";

export const dynamic = "force-dynamic";

// Webhook post-conversación: guarda transcripción, resumen y resultado, y
// actualiza la memoria del paciente. Configuralo en ElevenLabs → Agents → Settings.
export async function POST(request: Request) {
  const raw = await request.text();
  const secret = env.elevenLabsWebhookSecret();
  if (!secret) {
    console.error("Falta ELEVENLABS_WEBHOOK_SECRET: no se pueden validar los webhooks.");
    return NextResponse.json({ error: "Webhook sin configurar" }, { status: 500 });
  }
  if (!verifyWebhookSignature(raw, request.headers.get("elevenlabs-signature"), secret)) {
    return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  }

  const event = JSON.parse(raw) as { type: string; data: PostCallPayload };
  if (event.type === "post_call_transcription") {
    await recordConversation(event.data);
  }
  // post_call_audio y call_initiation_failure se aceptan pero no se guardan en el MVP.
  return NextResponse.json({ received: true });
}
