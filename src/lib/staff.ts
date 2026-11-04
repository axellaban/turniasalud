import "server-only";
import { sql } from "./db";
import { normalizePhone } from "./phone";

// Teléfonos del equipo del consultorio con acceso total a través de Sofi (por WhatsApp).

export type StaffPhone = { id: string; clinic_id: string; phone: string; name: string; created_at: string };

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
    "- Agenda: ver_agenda muestra los turnos de cualquier día y profesional.",
    "- Pacientes: buscar_pacientes por nombre, DNI o celular; crear_paciente si no está.",
    "- Turnos de otro paciente: mandá su paciente_id en consultar_disponibilidad, reservar_turno y ver_turnos_paciente. cancelar_turno, reprogramar_turno y confirmar_turno funcionan con cualquier turno_id de la agenda.",
    "- Es el consultorio: no le apliques las reglas de recepción (aviso mínimo, lo que mueve solo recepción) y puede dar las prestaciones que da solo el consultorio.",
    "- También puede bloquear la agenda (bloquear_agenda) y ver y resolver los pedidos al equipo (ver_tareas, resolver_tarea; con respuesta, le llega al paciente).",
    "- Antes de cancelar, mover, bloquear o responder a un paciente, repetí qué vas a hacer y esperá su «sí».",
  ].join("\n");
}
