import type { Prospect, SalesSettings } from "./service";
import { RESERVE_CENTS } from "./service";

export type SalesBlocker = { message: string; href: string; action: string };
/** La pantalla explica las mismas condiciones que vuelve a validar dialProspect bajo lock. */
export function salesCallBlockers(s: SalesSettings, budget: { today: string; spent: number }, pending: boolean, phoneConfigured: boolean, prospect?: Prospect): SalesBlocker[] {
  const blocks: SalesBlocker[] = [];
  if (s.needs_sync) blocks.push({ message: "La última aplicación no se pudo comprobar en ElevenLabs.", href: "/panel/comercial/configuracion", action: "Guardar y aplicar de nuevo" });
  if (!s.agent_id || !s.voice_id) blocks.push({ message: "Falta preparar a Sofi comercial.", href: "/panel/comercial/configuracion", action: "Guardar y aplicar la configuración" });
  if (!phoneConfigured) blocks.push({ message: "La línea saliente de Turnia no está configurada en el servidor.", href: "/panel/sistema", action: "Ver configuración del sistema" });
  if (!s.enabled) blocks.push({ message: "El piloto está pausado.", href: "#presupuesto", action: "Habilitar llamadas manuales hoy y guardar" });
  if (s.budget_date !== budget.today) blocks.push({ message: "La autorización de gasto venció o todavía no se guardó para hoy.", href: "#presupuesto", action: "Autorizar el cupo de hoy" });
  if (s.budget_cents - budget.spent < RESERVE_CENTS) blocks.push({ message: "El cupo disponible no alcanza la reserva de US$1 de otro intento.", href: "#presupuesto", action: "Revisar cupo y reservas de hoy" });
  if (pending) blocks.push({ message: "Hay una llamada pendiente o con inicio incierto. Primero hay que revisar su resultado.", href: "#pendiente", action: "Ver la llamada pendiente" });
  if (prospect?.suppressed) blocks.push({ message: "Este número pidió no recibir más llamadas. Está bloqueado en todas sus fichas.", href: "#contacto", action: "Ver el contacto" });
  if (prospect && !prospect.suppressed && (prospect.eligibility === "sin_revisar" || prospect.evidence.length < 15 || !prospect.reviewed_at || !Number.isFinite(Date.parse(prospect.reviewed_at)) || Date.now() - Date.parse(prospect.reviewed_at) > 24 * 3600_000)) blocks.push({ message: "Falta revisar el contacto o su revisión de 24 horas venció.", href: "#contacto", action: "Revisar el permiso y guardar" });
  return blocks;
}
