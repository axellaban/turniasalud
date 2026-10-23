import { NextResponse } from "next/server";
import { messagingSettings } from "@/lib/messaging-settings";
import { TELEGRAM_BOT_USERNAME, telegramConfigured } from "@/lib/telegram";
import { demoWhatsappNumber } from "@/lib/demo/config";
import { demoRequestText } from "@/lib/demo/flow";
import { createDemoHandoff } from "@/lib/demo/handoff";
import { normalizeWebsite } from "@/lib/demo/website";
import { missingWahaEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const settings = await messagingSettings();
  if (settings.active_channel === "pausado") return NextResponse.json({ error: "La demo está pausada. Probá más tarde." }, { status: 409 });
  const raw = await request.text();
  if (raw.length > 4096) return NextResponse.json({ error: "La dirección es demasiado larga." }, { status: 400 });
  let body: { website?: unknown };
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "Revisá la dirección web." }, { status: 400 }); }
  const website = typeof body?.website === "string" && body.website.length <= 2000 ? normalizeWebsite(body.website) : null;
  if (!website) return NextResponse.json({ error: "Revisá la dirección web." }, { status: 400 });
  if (settings.active_channel === "telegram") {
    if (!telegramConfigured() || !settings.telegram_ready) return NextResponse.json({ error: "Falta conectar el bot de Telegram." }, { status: 409 });
    const token = await createDemoHandoff(website, request.headers.get("x-real-ip") ?? "sin-ip");
    if (!token) return NextResponse.json({ error: "Ya pediste varias demos. Probá en un rato." }, { status: 429 });
    return NextResponse.json({ url: `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${token}` }, { headers: { "Cache-Control": "no-store" } });
  }
  const wa = missingWahaEnv().length ? null : (await demoWhatsappNumber()).number;
  if (!wa) return NextResponse.json({ error: "WhatsApp todavía no está disponible." }, { status: 409 });
  return NextResponse.json({ url: `https://wa.me/${wa}?text=${encodeURIComponent(demoRequestText(website))}` }, { headers: { "Cache-Control": "no-store" } });
}
