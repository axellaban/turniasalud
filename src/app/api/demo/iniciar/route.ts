import { after, NextResponse } from "next/server";
import { isConfigured, missingWahaEnv } from "@/lib/env";
import { messagingSettings } from "@/lib/messaging-settings";
import { TELEGRAM_BOT_USERNAME, telegramConfigured } from "@/lib/telegram";
import { demoWhatsappNumber } from "@/lib/demo/config";
import { demoRequestText } from "@/lib/demo/flow";
import { createDemoHandoff } from "@/lib/demo/handoff";
import { analyzeDemo } from "@/lib/demo/session";
import { startWebDemo } from "@/lib/demo/web";
import { normalizeManualClinic, normalizeWebsite } from "@/lib/demo/website";
import { syncLeadsToSheet } from "@/lib/leads-sheet";
import { recordDemo } from "@/lib/sales/outreach";

export const dynamic = "force-dynamic";
// En el navegador, la lectura de la web corre después de responder (≈1 minuto).
export const maxDuration = 300;

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;

export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > 4096) return NextResponse.json({ error: "La dirección es demasiado larga." }, { status: 400 });
  let body: { website?: unknown; email?: unknown; via?: unknown; nombre?: unknown; direccion?: unknown; especialidad?: unknown; profesional?: unknown; servicios?: unknown; ref?: unknown };
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "Revisá la dirección web." }, { status: 400 }); }
  const website = typeof body?.website === "string" && body.website.length <= 2000 ? normalizeWebsite(body.website) : null;
  // Sin web, alcanza con el nombre del consultorio (la demo se arma con eso).
  const manual = website ? null : normalizeManualClinic(body ?? {});
  if (!website && !manual) {
    const sent = typeof body?.website === "string" && body.website.trim();
    return NextResponse.json({ error: sent ? "Revisá la dirección web." : "Escribí la web de tu consultorio o, si no tiene, su nombre." }, { status: 400 });
  }
  // El email es opcional: si llega uno válido, queda en el pedido de demo.
  const typed = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const email = EMAIL.test(typed) ? typed : null;
  const ip = request.headers.get("x-real-ip") ?? "sin-ip";

  // Sin web no hay lectura que mandar por chat: va siempre al navegador.
  if (body.via === "navegador" || manual) {
    const ready = isConfigured();
    if (!ready.database || !ready.elevenlabs) return NextResponse.json({ error: "La demo en el navegador no está disponible por el momento." }, { status: 409 });
    const started = await startWebDemo({ website, manual, email, ip });
    if (!started) return NextResponse.json({ error: "Ya pediste varias demos. Probá en un rato." }, { status: 429 });
    after(() => analyzeDemo(started.sessionId));
    after(() => syncLeadsToSheet([started.leadId]));
    // Llegó desde el link de su demo (/p/<código>): queda en su ficha de la prospección.
    if (typeof body.ref === "string") after(() => recordDemo(body.ref as string, started.leadId));
    return NextResponse.json({ url: `/probar-demo/sesion/${started.token}` }, { headers: { "Cache-Control": "no-store" } });
  }
  if (!website) return NextResponse.json({ error: "Revisá la dirección web." }, { status: 400 });

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
