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
const SECOND_TYPE =
  "Si el paciente quiere otra práctica en la misma visita (por ejemplo, control y limpieza): el id de esa segunda práctica, copiado del catálogo. Devuelve horarios en los que entran las dos, seguidas y con el mismo profesional.";

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "buscar_paciente",
    description:
      "Busca la ficha de alguien que dice (o da a entender) que ya es paciente, cuando el contexto no trae su ficha: escribe desde otro número o por la web. Necesitás su DNI y su nombre y apellido: si ya te los dijo, usala enseguida sin volver a pedírselos. Solo si hace falta te va a pedir la fecha de nacimiento. Para un turno existente mandá para_turno_existente=true en cada intento. Si devuelve solo_turnos, continuá con ver_turnos_paciente y gestioná solo el turno pedido.",
    params: {
      dni: { type: "string", description: "DNI, solo números.", required: true },
      fecha_nacimiento: { type: "string", description: isoDate },
      para_turno_existente: { type: "boolean", description: "true si busca confirmar, mover o cancelar un turno que ya existe. Repetilo si te pide verificar otro dato." },
      nombre_completo: { type: "string", description: "Nombre y apellido, si te lo dijo." },
    },
    schema: z.object({
      dni: z.string().min(1),
      fecha_nacimiento: z.string().optional(),
      para_turno_existente: z.boolean().optional(),
      nombre_completo: z.string().optional(),
    }),
  },
  {
    name: "registrar_paciente",
    description:
      "Guarda o actualiza los datos del paciente con el que estás hablando (nombre, DNI, cobertura, etc.). Usala para admisión de un turno nuevo o cuando el paciente quiere actualizar sus datos. Para encontrar, mover o cancelar un turno existente, usá buscar_paciente y ver_turnos_paciente sin registrar otra ficha.",
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
      "Busca horarios libres reales para reservar (tipo_turno_id) o mover un turno existente (turno_id). Usala SIEMPRE antes de ofrecer horarios; nunca inventes horarios. Ya deja afuera a los profesionales que no atienden la cobertura del paciente (si viene 'aviso_cobertura', decíselo antes de ofrecer), y con un turno de urgencia busca hoy y mañana. Si trae 'preguntar_antes', preguntalo antes de reservar.",
    params: {
      tipo_turno_id: { type: "string", description: "Para reservar: id del tipo de turno, copiado del catálogo." },
      turno_id: { type: "string", description: "Para reprogramar: turno_id del turno existente (si son dos prácticas seguidas, usá el de la primera)." },
      segundo_tipo_turno_id: { type: "string", description: SECOND_TYPE },
      profesional_id: { type: "string", description: "id del profesional si el paciente pidió uno en particular." },
      desde: { type: "string", description: `Primer día a buscar. ${isoDate} Por defecto, hoy.` },
      hasta: { type: "string", description: `Último día a buscar. ${isoDate} Por defecto, dos semanas después de 'desde'.` },
      franja: { type: "string", description: "Franja horaria preferida.", enum: ["manana", "tarde", "cualquiera"] },
      cobertura: {
        type: "string",
        description: "Solo si el paciente se va a atender con otra cobertura que la de su ficha (por ejemplo, 'Particular'). Si no, se usa la de la ficha.",
      },
    },
    schema: z.object({
      tipo_turno_id: z.string().min(1).optional(),
      turno_id: z.string().min(1).optional(),
      segundo_tipo_turno_id: z.string().optional(),
      profesional_id: z.string().optional(),
      desde: z.string().optional(),
      hasta: z.string().optional(),
      franja: z.enum(["manana", "tarde", "cualquiera"]).optional(),
      cobertura: z.string().optional(),
    }).refine((input) => Boolean(input.tipo_turno_id) !== Boolean(input.turno_id), "Usá tipo_turno_id para reservar o turno_id para reprogramar."),
  },
  {
    name: "reservar_turno",
    description:
      "Reserva un turno (o dos prácticas seguidas en la misma visita). Solo después de que el paciente confirmó explícitamente día, hora y profesional. Usá 'inicio' y 'profesional_id' exactamente como los devolvió consultar_disponibilidad. Para sumar una práctica a continuación de un turno que ya tiene, mandá el tipo_turno_id, el profesional_id y el inicio de ese turno y la práctica nueva en segundo_tipo_turno_id.",
    params: {
      tipo_turno_id: { type: "string", description: "id del tipo de turno.", required: true },
      segundo_tipo_turno_id: { type: "string", description: "id de la segunda práctica de la misma visita, el mismo que usaste en consultar_disponibilidad: se reserva a continuación, con el mismo profesional." },
      profesional_id: { type: "string", description: "id del profesional.", required: true },
      inicio: { type: "string", description: "Fecha y hora de inicio en ISO 8601, tal cual vino en consultar_disponibilidad.", required: true },
      nombre_completo: { type: "string", description: "Nombre y apellido del paciente, si todavía no lo registraste." },
      cobertura: { type: "string", description: "Cobertura con la que se atiende en este turno." },
      notas: { type: "string", description: "Motivo de consulta u observaciones breves para el profesional." },
      titulo: {
        type: "string",
        description:
          "Solo si pidió una consulta sobre un tratamiento (implantes, prótesis, blanqueamiento, ortodoncia…) y reservás la prestación de consulta: cómo se llama el turno, por ejemplo «Consulta de implantes». Así figura en la agenda, en la ficha y en el recordatorio.",
      },
    },
    schema: z.object({
      tipo_turno_id: z.string().min(1),
      segundo_tipo_turno_id: z.string().optional(),
      profesional_id: z.string().min(1),
      inicio: z.string().min(1),
      nombre_completo: z.string().optional(),
      cobertura: z.string().optional(),
      notas: z.string().optional(),
      titulo: z.string().optional(),
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
      "Mueve un turno existente a un nuevo horario. Primero usá consultar_disponibilidad con el turno_id del turno existente y confirmá el nuevo horario con el paciente. Si son dos prácticas seguidas de la misma visita, usá el turno_id de la primera para consultar y para moverlas juntas.",
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
