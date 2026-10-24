import { NextResponse, after } from "next/server";
import { z } from "zod";
import { messagingSettings, ChannelPausedError } from "@/lib/messaging-settings";
import { telegramDownloadAudio, telegramSendText, verifyTelegramSecret } from "@/lib/telegram";
import { AUDIO_FAILED_REPLY, claimEvent, releaseEvent } from "@/lib/channel";
import { transcribeAudio } from "@/lib/elevenlabs";
import { analyzeDemo, handleDemoMessage } from "@/lib/demo/session";
import { attachLeadEmail, claimDemoHandoff } from "@/lib/demo/handoff";
import { demoRequestText } from "@/lib/demo/flow";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const media = z.object({ file_id: z.string().min(1).max(300), file_size: z.number().optional(), mime_type: z.string().max(100).optional() });
const updateSchema = z.object({
  update_id: z.number().int().nonnegative().safe(),
  message: z.object({
    message_id: z.number().int().positive().safe(),
    date: z.number().optional(),
    from: z.object({ id: z.number().int().positive().safe(), is_bot: z.boolean() }),
    chat: z.object({ id: z.number().int().safe(), type: z.string() }),
    text: z.string().max(8000).optional(), caption: z.string().max(2000).optional(),
    voice: media.optional(), audio: media.optional(),
  }).optional(),
});

export async function POST(request: Request) {
  if (!verifyTelegramSecret(request.headers.get("x-telegram-bot-api-secret-token"))) return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  if ((await messagingSettings()).active_channel !== "telegram") return NextResponse.json({ ignored: "canal pausado" });
  const raw = await request.text();
  if (raw.length > 64000) return NextResponse.json({ error: "Evento demasiado grande" }, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  const update = updateSchema.safeParse(body).data;
  const msg = update?.message;
  if (!msg || msg.chat.type !== "private" || msg.from.is_bot || msg.chat.id !== msg.from.id) return NextResponse.json({ ignored: "solo chats privados" });
  // Mensajes acumulados durante una pausa no reinician la demo al habilitar el bot.
  if (msg.date && msg.date * 1000 < Date.now() - 5 * 60_000) return NextResponse.json({ ignored: "mensaje vencido" });
  const key = `telegram:in:${update!.update_id}`;
  if (!(await claimEvent(key))) return NextResponse.json({ duplicate: true });
  const chatId = `telegram:${msg.chat.id}`;
  const phone = `telegram:${msg.from.id}`;
  try {
    let text = (msg.text ?? msg.caption ?? "").trim();
    let startEmail: string | null = null;
    const start = /^\/start(?:@\w+)?(?:\s+(\S+))?$/i.exec(text);
    if (start) {
      if (start[1]?.startsWith("p_")) {
        text = `Probar perfil de Turnia: ${start[1]}`;
      } else {
      const handoff = await claimDemoHandoff(start[1] ?? "", phone);
      if (!handoff) {
        await telegramSendText(chatId, `¡Hola! Para probarme como recepcionista de tu consultorio, dejá tu web acá y tocá Probar demo: ${env.appUrl()}/probar-demo`);
        return NextResponse.json({ ok: true });
      }
      text = demoRequestText(handoff.website);
      startEmail = handoff.email;
      }
    }
    const audio = msg.voice ?? msg.audio;
    if (audio) {
      const heard = (audio.file_size ?? 0) > 20 * 1024 * 1024 ? "" : await telegramDownloadAudio(audio.file_id)
        .then((blob) => transcribeAudio(blob, audio.mime_type ?? "audio/ogg")).catch(() => "");
      if (!heard) {
        await telegramSendText(chatId, AUDIO_FAILED_REPLY);
        return NextResponse.json({ ok: true, audio: "sin_transcripcion" });
      }
      text = `(audio) ${heard}${text ? `\n${text}` : ""}`;
    }
    if (!text) {
      await telegramSendText(chatId, "Podés escribirme o mandarme una nota de voz. Por ahora no leo fotos ni archivos.");
      return NextResponse.json({ ok: true });
    }
    const demo = await handleDemoMessage({ messageId: `telegram:${msg.chat.id}:${msg.message_id}`, chatId, phone, text });
    if (!demo) {
      await telegramSendText(chatId, `Para empezar, mandame «Quiero probar la demo» con la web de tu consultorio, o completala acá: ${env.appUrl()}/probar-demo`);
      return NextResponse.json({ ok: true });
    }
    if (startEmail) await attachLeadEmail(phone, startEmail);
    if (demo.analyze) { const id = demo.analyze; after(() => analyzeDemo(id)); }
    return NextResponse.json({ ok: true, demo: demo.status });
  } catch (error) {
    if (error instanceof ChannelPausedError) return NextResponse.json({ ignored: "canal pausado" });
    await releaseEvent(key);
    console.error("Telegram: no se pudo procesar el mensaje.");
    return NextResponse.json({ error: "No se pudo procesar el mensaje" }, { status: 502 });
  }
}
