import "server-only";
import { sql } from "./db";
import { normalizePhone } from "./phone";

// Teléfonos del equipo del consultorio con acceso total a través de Sofi (por WhatsApp).

export type StaffPhone = { id: string; clinic_id: string; phone: string; name: string; daily_summary: boolean; created_at: string };

/** ¿Este número es del equipo de la clínica? Solo vale para números verificados (WhatsApp). */
export async function staffForPhone(clinicId: string, phone: string | null | undefined): Promise<StaffPhone | null> {
  const normalized = normalizePhone(phone);
  if (!/^\d{8,15}$/.test(normalized)) return null;
  const [row] = await sql<StaffPhone[]>`select * from clinic_staff_phones where clinic_id = ${clinicId} and phone = ${normalized}`;
  return row ?? null;
}

export async function listStaffPhones(clinicId: string): Promise<StaffPhone[]> {
  return [...(await sql<StaffPhone[]>`select * from clinic_staff_phones where clinic_id = ${clinicId} order by created_at`)];
}

/** Lo que Sofi sabe cuando le escribe alguien del equipo (va antes de su ficha de paciente, si tiene). */
export function staffContextText(name: string): string {
  return [
    `EQUIPO DEL CONSULTORIO: este número es de ${name}, con acceso total. No es un paciente, salvo que pida algo para sí mismo. No le pidas datos para identificarlo.`,
    "- Agenda: ver_agenda muestra los turnos de cualquier día y profesional, con quién dio cada uno («dio»).",
    "- ¿Este turno lo diste vos?: buscalo con ver_agenda (día y hora) y contestá con detalle_turno: quién lo dio y cuándo, paciente, DNI, celular, prestación, cobertura, lo que pidió y la nota para copiar en su agenda. Lo que diste, moviste y cancelaste desde un día: turnos_de_sofi.",
    // Sin nombres de herramientas que cambiaron: este texto va en cada charla y el agente de ElevenLabs
    // puede tener todavía los nombres anteriores hasta que se actualiza.
    "- Pacientes: buscalos por nombre, DNI o celular con la herramienta del equipo para buscar pacientes; si no está, creá su ficha con la del equipo para crear pacientes.",
    "- Turnos de otro paciente: mandá su paciente_id en consultar_disponibilidad, reservar_turno y ver_turnos_paciente. cancelar_turno, reprogramar_turno y confirmar_turno funcionan con cualquier turno_id de la agenda.",
    "- Es el consultorio: no le apliques las reglas de recepción (aviso mínimo, lo que mueve solo recepción) y puede dar las prestaciones que da solo el consultorio.",
    "- También puede bloquear la agenda (bloquear_agenda) y ver y resolver los pedidos al equipo (ver_tareas, resolver_tarea; con respuesta, le llega al paciente).",
    "- Antes de cancelar, mover, bloquear o responder a un paciente, repetí qué vas a hacer y esperá su «sí».",
  ].join("\n");
}
