"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { sql } from "@/lib/db";
import { requireAdmin } from "@/lib/panel-clinic";
import { ElevenLabsError } from "@/lib/elevenlabs";
import { setupSalesAgent, sofiSalesVoiceId, SalesSetupError } from "@/lib/sales/agent";
import { salesConfiguration, salesConfigurationSchema, type SalesConfiguration } from "@/lib/sales/config";
import { authorizeBudget, blockProspect, dialProspect, refreshSalesCall, salesSettings, saveProspect, updateSalesPhone, SalesError } from "@/lib/sales/service";

export type SalesActionState = { message?: string; error?: string; prospectId?: string; configuration?: SalesConfiguration & { voice_id: string; version: number } };
export async function salesAction(_previous: SalesActionState, form: FormData): Promise<SalesActionState> {
  await requireAdmin();
  const intent = form.get("intent");
  let result: SalesActionState = {};
  try {
    if (intent === "prepare" || intent === "prepare_sofi") {
      await setupSalesAgent(intent === "prepare_sofi" ? await sofiSalesVoiceId() : String(form.get("voice_id") || ""));
      result = { message: "Configuración guardada de Sofi comercial sincronizada con ElevenLabs. Límite de 60 segundos de conversación, más despedida. El piloto queda pausado. No se inició ninguna llamada." };
    } else if (intent === "configure" || intent === "restore_config") {
      const expectedVersion = z.coerce.number().int().nonnegative().parse(form.get("config_version"));
      if (intent === "restore_config") {
        await setupSalesAgent(undefined, { expectedVersion, restorePrevious: true });
      } else {
        const config = salesConfigurationSchema.parse(Object.fromEntries(form));
        const selected = z.string().min(1, "Elegí una voz.").max(200).parse(form.get("voice_id"));
        await setupSalesAgent(selected === "sofi" ? await sofiSalesVoiceId() : selected, { expectedVersion, config });
      }
      result = { message: intent === "restore_config" ? "Versión anterior restaurada y comprobada en ElevenLabs. El piloto queda pausado; no se inició ninguna llamada." : "Saludo, instrucciones y voz guardados y comprobados en ElevenLabs. El piloto queda pausado; no se inició ninguna llamada." };
      const s = await salesSettings();
      result.configuration = { ...salesConfiguration(s), voice_id: s.voice_id!, version: s.config_version };
    } else if (intent === "budget") {
      const dollars = z.string().regex(/^\d{1,3}(?:[.,]\d{1,2})?$/, "Ingresá un importe en dólares, sin signo.").parse(form.get("budget"));
      const enabled = form.get("enabled") === "on";
      if (enabled && form.get("authorize") !== "on") throw new SalesError("Confirmá el gasto antes de habilitar el piloto.");
      await authorizeBudget(Math.round(Number(dollars.replace(",",".")) * 100), enabled);
      result = { message: enabled ? "Cupo autorizado solo para hoy. Cada llamada requiere tu confirmación individual." : "Piloto pausado. No se inician llamadas nuevas; una llamada en curso conserva el límite de 60 segundos de conversación, más despedida." };
    } else if (intent === "prospect") {
      result = { prospectId: await saveProspect(Object.fromEntries(form)), message: "Consultorio guardado. Todavía no se llamó." };
    } else if (intent === "review") {
      const p = z.object({ id: z.uuid(), expected_phone: z.string().min(1), business_name: z.string().trim().min(3, "Ingresá el nombre de la clínica que dirá Sofi.").max(160), eligibility: z.enum(["sin_revisar", "solicito_llamada", "no_llame_revisado"]), evidence: z.string().trim().max(1500), context: z.string().trim().max(3000) }).parse(Object.fromEntries(form));
      if (p.eligibility !== "sin_revisar" && p.evidence.length < 15) throw new SalesError("Anotá la fuente y fecha del permiso o de la revisión de No Llame.");
      const updated = await sql`update sales_prospects set business_name = ${p.business_name}, eligibility = ${p.eligibility}, evidence = ${p.evidence}, context = ${p.context}, reviewed_at = ${p.eligibility === "sin_revisar" ? null : new Date().toISOString()} where id = ${p.id} and phone = ${p.expected_phone} returning id`;
      if (!updated.length) throw new SalesError("Cambió el teléfono de esta ficha. Recargá y revisá el nuevo destinatario antes de guardar.");
      result = { message: "Nombre de la clínica, datos y revisión guardados. Sofi usará este nombre en las próximas llamadas. La revisión vale 24 horas." };
    } else if (intent === "phone") {
      await updateSalesPhone(String(form.get("id")), String(form.get("phone")), String(form.get("expected_phone")));
      result = { message: "Número guardado. Si cambió el destinatario, revisá su permiso de contacto antes de llamar. No se inició ninguna llamada." };
    } else if (intent === "dial") {
      if (form.get("confirm") !== "on") throw new SalesError("Confirmá el destinatario de esta única llamada.");
      const expectedPhone = z.string().min(1, "Recargá la ficha y confirmá el teléfono antes de llamar.").parse(form.get("expected_phone"));
      await dialProspect(String(form.get("id")),String(form.get("request_key")),expectedPhone);
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
    revalidatePath("/panel/comercial", "layout");
    return { error: e instanceof SalesError || e instanceof SalesSetupError ? e.message : e instanceof z.ZodError ? e.issues.map((i) => i.message).join(". ") : e instanceof ElevenLabsError ? `ElevenLabs rechazó la operación (HTTP ${e.status}). No se inició una llamada. Revisá la configuración antes de repetirla.` : "No se completó la operación. Revisá la configuración del proveedor y volvé a consultar el estado antes de repetirla." };
  }
  revalidatePath("/panel/comercial", "layout");
  return result;
}
