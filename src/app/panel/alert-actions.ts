"use server";

import { randomUUID } from "node:crypto";
import { requireAdmin } from "@/lib/panel-clinic";
import { sql } from "@/lib/db";
import { notifyN8n } from "@/lib/n8n";
import type { FormState } from "./actions";

/** Prueba el respaldo real con las variables de producción, sin hacer fallar WhatsApp. */
export async function testAxelEmail(): Promise<FormState> {
  await requireAdmin();
  const key = `email-test:${Math.floor(Date.now() / 60000)}`;
  const [claimed] = await sql`insert into channel_events (key) values (${key}) on conflict (key) do nothing returning key`;
  if (!claimed) return { ok: false, message: "Ya se pidió una prueba este minuto. Revisá tu correo antes de repetirla." };
  const code = "TURNIA-EMAIL-" + randomUUID().slice(0, 8);
  const accepted = await notifyN8n("axel.aviso", {
    texto: `Prueba de avisos técnicos de Turnia. No es una caída real.\n\nCódigo: ${code}\n\nEste email comprueba el canal de respaldo cuando no puede salir el WhatsApp general.\nPanel: https://turniasalud.app/panel/sistema`,
  });
  if (!accepted) {
    await sql`delete from channel_events where key = ${key}`;
    return { ok: false, message: "n8n no aceptó la prueba. Revisá la conexión y sus ejecuciones antes de repetirla." };
  }
  return { ok: true, message: `Prueba recibida por n8n (${code}). Comprobá que llegó a tu correo; esta respuesta todavía no confirma la entrega.` };
}
