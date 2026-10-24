import { after, NextResponse } from "next/server";
import { isConfigured, missingWahaEnv } from "@/lib/env";
import { messagingSettings } from "@/lib/messaging-settings";
import { TELEGRAM_BOT_USERNAME, telegramConfigured } from "@/lib/telegram";
import { demoWhatsappNumber } from "@/lib/demo/config";
import { demoRequestText } from "@/lib/demo/flow";
import { createDemoHandoff } from "@/lib/demo/handoff";
import { analyzeDemo } from "@/lib/demo/session";
import { startWebDemo } from "@/lib/demo/web";
import { normalizeWebsite } from "@/lib/demo/website";

export const dynamic = "force-dynamic";
// En el navegador, la lectura de la web corre después de responder (≈1 minuto).
export const maxDuration = 300;

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;

export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > 4096) return NextResponse.json({ error: "La dirección es demasiado larga." }, { status: 400 });
  let body: { website?: unknown; email?: unknown; via?: unknown };
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "Revisá la dirección web." }, { status: 400 }); }
  const website = typeof body?.website === "string" && body.website.length <= 2000 ? normalizeWebsite(body.website) : null;
  if (!website) return NextResponse.json({ error: "Revisá la dirección web." }, { status: 400 });
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL.test(email)) return NextResponse.json({ error: "Revisá tu email. Por ejemplo: nombre@miclinica.com.ar" }, { status: 400 });
  const ip = request.headers.get("x-real-ip") ?? "sin-ip";

  if (body.via === "navegador") {
    const ready = isConfigured();
    if (!ready.database || !ready.elevenlabs) return NextResponse.json({ error: "La demo en el navegador no está disponible por el momento." }, { status: 409 });
    const started = await startWebDemo({ website, email, ip });
    if (!started) return NextResponse.json({ error: "Ya pediste varias demos. Probá en un rato." }, { status: 429 });
    after(() => analyzeDemo(started.sessionId));
    return NextResponse.json({ url: `/probar-demo/sesion/${started.token}` }, { headers: { "Cache-Control": "no-store" } });
  }

  const settings = await messagingSettings();
  if (settings.active_channel === "pausado") return NextResponse.json({ error: "La demo por chat está pausada. Probala en el navegador." }, { status: 409 });
  if (settings.active_channel === "telegram") {
    if (!telegramConfigured() || !settings.telegram_ready) return NextResponse.json({ error: "Falta conectar el bot de Telegram." }, { status: 409 });
    const token = await createDemoHandoff(website, ip, email);
    if (!token) return NextResponse.json({ error: "Ya pediste varias demos. Probá en un rato." }, { status: 429 });
    return NextResponse.json({ url: `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${token}` }, { headers: { "Cache-Control": "no-store" } });
  }
  const wa = missingWahaEnv().length ? null : (await demoWhatsappNumber()).number;
  if (!wa) return NextResponse.json({ error: "WhatsApp todavía no está disponible." }, { status: 409 });
  return NextResponse.json({ url: `https://wa.me/${wa}?text=${encodeURIComponent(demoRequestText(website))}` }, { headers: { "Cache-Control": "no-store" } });
}
