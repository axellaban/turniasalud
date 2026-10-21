import { z } from "zod";
import { TASK_PRIORITIES, TASK_TYPES } from "../types";

// Definición única de las herramientas del agente: de acá salen tanto la
// validación del endpoint como la configuración que se sube a ElevenLabs.

type Param = {
  type: "string" | "number" | "boolean";
  description: string;
  enum?: readonly string[];
  required?: boolean;
};

export type ToolDefinition = {
  name: string;
  description: string;
  params: Record<string, Param>;
  schema: z.ZodType<Record<string, unknown>>;
};

const isoDate = "Fecha en formato AAAA-MM-DD (hora de Argentina).";

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "registrar_paciente",
    description:
      "Guarda o actualiza los datos del paciente con el que estás hablando (nombre, DNI, cobertura, etc.). Usala apenas el paciente te dé datos nuevos, antes de reservar.",
    params: {
      nombre_completo: { type: "string", description: "Nombre y apellido del paciente." },
      dni: { type: "string", description: "DNI, solo números." },
      fecha_nacimiento: { type: "string", description: isoDate },
      email: { type: "string", description: "Email del paciente." },
      cobertura: { type: "string", description: "Obra social o prepaga (ej. OSDE, Swiss Medical) o 'Particular'." },
      plan: { type: "string", description: "Plan de la cobertura (ej. 310, SMG20)." },
      numero_afiliado: { type: "string", description: "Número de afiliado o credencial." },
      preferencias: { type: "string", description: "Preferencias del paciente (ej. 'prefiere turnos a la mañana')." },
      no_recibir_mensajes: {
        type: "boolean",
        description: "true si el paciente pide que no le escriban más para campañas o avisos; false si vuelve a aceptar. No lo mandes si no habló del tema.",
      },
    },
    schema: z.object({
      nombre_completo: z.string().optional(),
      dni: z.string().optional(),
      fecha_nacimiento: z.string().optional(),
      email: z.string().optional(),
      cobertura: z.string().optional(),
      plan: z.string().optional(),
      numero_afiliado: z.string().optional(),
      preferencias: z.string().optional(),
      no_recibir_mensajes: z.boolean().optional(),
    }),
  },
  {
    name: "consultar_disponibilidad",
    description:
      "Busca turnos libres reales para un tipo de turno. Usala SIEMPRE antes de ofrecer horarios; nunca inventes horarios.",
    params: {
      tipo_turno_id: { type: "string", description: "id del tipo de turno, copiado del catálogo.", required: true },
      profesional_id: { type: "string", description: "id del profesional si el paciente pidió uno en particular." },
      desde: { type: "string", description: `Primer día a buscar. ${isoDate} Por defecto, hoy.` },
      hasta: { type: "string", description: `Último día a buscar. ${isoDate} Por defecto, dos semanas después de 'desde'.` },
      franja: { type: "string", description: "Franja horaria preferida.", enum: ["manana", "tarde", "cualquiera"] },
    },
    schema: z.object({
      tipo_turno_id: z.string().min(1),
      profesional_id: z.string().optional(),
      desde: z.string().optional(),
      hasta: z.string().optional(),
      franja: z.enum(["manana", "tarde", "cualquiera"]).optional(),
    }),
  },
  {
    name: "reservar_turno",
    description:
      "Reserva un turno. Solo después de que el paciente confirmó explícitamente día, hora y profesional. Usá 'inicio' y 'profesional_id' exactamente como los devolvió consultar_disponibilidad.",
    params: {
      tipo_turno_id: { type: "string", description: "id del tipo de turno.", required: true },
      profesional_id: { type: "string", description: "id del profesional.", required: true },
      inicio: { type: "string", description: "Fecha y hora de inicio en ISO 8601, tal cual vino en consultar_disponibilidad.", required: true },
      nombre_completo: { type: "string", description: "Nombre y apellido del paciente, si todavía no lo registraste." },
      cobertura: { type: "string", description: "Cobertura con la que se atiende en este turno." },
      notas: { type: "string", description: "Motivo de consulta u observaciones breves para el profesional." },
    },
    schema: z.object({
      tipo_turno_id: z.string().min(1),
      profesional_id: z.string().min(1),
      inicio: z.string().min(1),
      nombre_completo: z.string().optional(),
      cobertura: z.string().optional(),
      notas: z.string().optional(),
    }),
  },
  {
    name: "ver_turnos_paciente",
    description: "Lista los próximos turnos del paciente (para confirmarlos, cancelarlos o reprogramarlos).",
    params: {},
    schema: z.object({}),
  },
  {
    name: "confirmar_turno",
    description:
      "Marca que el paciente confirmó que va a venir a un turno (por ejemplo, cuando responde que sí a un recordatorio).",
    params: {
      turno_id: { type: "string", description: "turno_id del turno que confirma.", required: true },
    },
    schema: z.object({ turno_id: z.string().min(1) }),
  },
  {
    name: "cancelar_turno",
    description: "Cancela un turno del paciente. Confirmá con el paciente antes de cancelar.",
    params: {
      turno_id: { type: "string", description: "turno_id que devolvió ver_turnos_paciente.", required: true },
      motivo: { type: "string", description: "Motivo de la cancelación." },
    },
    schema: z.object({ turno_id: z.string().min(1), motivo: z.string().optional() }),
  },
  {
    name: "reprogramar_turno",
    description:
      "Mueve un turno existente a un nuevo horario. Primero consultá disponibilidad para el mismo tipo de turno y confirmá el nuevo horario con el paciente.",
    params: {
      turno_id: { type: "string", description: "turno_id del turno a mover.", required: true },
      nuevo_inicio: { type: "string", description: "Nuevo inicio en ISO 8601, tal cual vino en consultar_disponibilidad.", required: true },
      profesional_id: { type: "string", description: "id del profesional del nuevo horario, si cambia." },
    },
    schema: z.object({ turno_id: z.string().min(1), nuevo_inicio: z.string().min(1), profesional_id: z.string().optional() }),
  },
  {
    name: "crear_tarea",
    description:
      "Crea una tarea para el equipo de la clínica cuando el pedido necesita a una persona: recetas, resultados, consultas clínicas, órdenes médicas o derivaciones que no podés agendar, facturación, pedidos de hablar con alguien, o urgencias.",
    params: {
      tipo: { type: "string", description: "Tipo de pedido.", enum: TASK_TYPES, required: true },
      prioridad: { type: "string", description: "Prioridad.", enum: TASK_PRIORITIES },
      titulo: { type: "string", description: "Resumen de una línea (ej. 'Renovar receta de ibuprofeno').", required: true },
      detalle: { type: "string", description: "Todo lo que el equipo necesita saber para resolverlo sin volver a preguntar." },
    },
    schema: z.object({
      tipo: z.enum(TASK_TYPES),
      prioridad: z.enum(TASK_PRIORITIES).optional(),
      titulo: z.string().min(1),
      detalle: z.string().optional(),
    }),
  },
  {
    name: "anotar_lista_espera",
    description: "Anota al paciente en la lista de espera cuando no le sirve ningún horario disponible. Si se libera un turno, le escribimos.",
    params: {
      tipo_turno_id: { type: "string", description: "id del tipo de turno.", required: true },
      profesional_id: { type: "string", description: "id del profesional, si quiere uno en particular." },
      preferencias: { type: "string", description: "Días y horarios que le sirven." },
    },
    schema: z.object({ tipo_turno_id: z.string().min(1), profesional_id: z.string().optional(), preferencias: z.string().optional() }),
  },
];

/** Parámetros que no completa el LLM sino ElevenLabs, a partir de variables dinámicas. */
export const CONTEXT_PARAMS: Record<string, { dynamic_variable: string; description: string }> = {
  clinic_id: { dynamic_variable: "clinic_id", description: "Clínica" },
  patient_phone: { dynamic_variable: "patient_phone", description: "Teléfono del paciente" },
  conversation_id: { dynamic_variable: "system__conversation_id", description: "Conversación" },
  canal: { dynamic_variable: "system__channel", description: "Canal" },
};

export const contextSchema = z.object({
  clinic_id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
  patient_phone: z.string().min(1),
  conversation_id: z.string().optional(),
  canal: z.string().optional(),
});

export function getToolDefinition(name: string): ToolDefinition | undefined {
  return TOOL_DEFINITIONS.find((t) => t.name === name);
}
