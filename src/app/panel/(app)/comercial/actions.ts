"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sql } from "@/lib/db";
import { requireAdmin } from "@/lib/panel-clinic";
import { ElevenLabsError } from "@/lib/elevenlabs";
import { setupSalesAgent, SalesSetupError } from "@/lib/sales/agent";
import { authorizeBudget, blockProspect, dialProspect, refreshSalesCall, saveProspect, SalesError } from "@/lib/sales/service";

export type SalesActionState = { message?: string; error?: string; prospectId?: string };
export async function salesAction(_previous: SalesActionState, form: FormData): Promise<SalesActionState> {
  await requireAdmin();
  const intent = form.get("intent");
  let result: SalesActionState = {};
  try {
    if (intent === "prepare") {
      await setupSalesAgent(String(form.get("voice_id") || ""));
      result = { message: "Agustín preparado con su voz, herramientas comerciales y máximo de 60 segundos. El piloto queda pausado. No se inició ninguna llamada." };
    } else if (intent === "budget") {
      const dollars = z.string().regex(/^\d{1,3}(?:[.,]\d{1,2})?$/, "Ingresá un importe en dólares, sin signo.").parse(form.get("budget"));
      const enabled = form.get("enabled") === "on";
      if (enabled && form.get("authorize") !== "on") throw new SalesError("Confirmá el gasto antes de habilitar el piloto.");
      await authorizeBudget(Math.round(Number(dollars.replace(",",".")) * 100), enabled);
      result = { message: enabled ? "Cupo autorizado solo para hoy. Cada llamada requiere tu confirmación individual." : "Piloto pausado. No se inician llamadas nuevas; una llamada que ya empezó termina por su límite de 60 segundos." };
    } else if (intent === "prospect") {
      result = { prospectId: await saveProspect(Object.fromEntries(form)), message: "Consultorio guardado. Todavía no se llamó." };
    } else if (intent === "review") {
      const p = z.object({ id: z.uuid(), eligibility: z.enum(["sin_revisar", "solicito_llamada", "no_llame_revisado"]), evidence: z.string().trim().max(1500), context: z.string().trim().max(3000) }).parse(Object.fromEntries(form));
      if (p.eligibility !== "sin_revisar" && p.evidence.length < 15) throw new SalesError("Anotá la fuente y fecha del permiso o de la revisión de No Llame.");
      await sql`update sales_prospects set eligibility = ${p.eligibility}, evidence = ${p.evidence}, context = ${p.context}, reviewed_at = ${p.eligibility === "sin_revisar" ? null : new Date().toISOString()} where id = ${p.id}`;
      result = { message: "Contexto y revisión guardados. La revisión de contacto vale 24 horas." };
    } else if (intent === "dial") {
      if (form.get("confirm") !== "on") throw new SalesError("Confirmá el destinatario de esta única llamada.");
      await dialProspect(String(form.get("id")),String(form.get("request_key")));
      result = { message: "Intento registrado. Revisá el estado y actualizá el resultado; no repitas si el inicio quedó incierto." };
    } else if (intent === "refresh") {
      await refreshSalesCall(String(form.get("call_id")), String(form.get("conversation_id") || ""));
      result = { message: "Resultado actualizado desde ElevenLabs." };
    } else if (intent === "block") {
      await blockProspect(String(form.get("id")));
      result = { message: "Número bloqueado para futuras llamadas, incluso en fichas duplicadas." };
    } else throw new SalesError("Acción inválida.");
  } catch (e) {
    // Los errores del proveedor pueden incluir variables privadas. Nunca devolver su cuerpo al cliente.
    return { error: e instanceof SalesError || e instanceof SalesSetupError ? e.message : e instanceof z.ZodError ? e.issues.map((i) => i.message).join(". ") : e instanceof ElevenLabsError ? `ElevenLabs rechazó la operación (HTTP ${e.status}). No se inició una llamada. Revisá la configuración antes de repetirla.` : "No se completó la operación. Revisá la configuración del proveedor y volvé a consultar el estado antes de repetirla." };
  }
  revalidatePath("/panel/comercial", "layout");
  return result;
}
