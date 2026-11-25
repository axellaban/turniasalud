import { z } from "zod";
import { TASK_PRIORITIES, TASK_TYPES } from "../types";
import { HEALTH_QUESTIONS } from "../health-form";

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
/** Para el equipo del consultorio: el paciente para el que se pide (de equipo_buscar_pacientes o ver_agenda). */
const PATIENT_PARAM = {
  type: "string" as const,
  description: "Solo si te escribe alguien del equipo del consultorio (el contexto lo dice): el paciente_id del paciente para el que pide, de equipo_buscar_pacientes o ver_agenda. Con un paciente, no lo mandes.",
};
const STAFF = "Solo para el equipo del consultorio (el contexto lo dice); con un paciente, no la uses.";

const SECOND_TYPE =
  "Si el paciente quiere otra práctica en la misma visita (por ejemplo, control y limpieza): el id de esa segunda práctica, copiado del catálogo. Devuelve horarios en los que entran las dos, seguidas y con el mismo profesional.";

/** Una pregunta de la ficha de salud por parámetro: así el agente no puede saltearse ninguna. */
const YES_NO = ["si", "no"] as const;
const healthQuestionParams: Record<string, Param> = Object.fromEntries(
  HEALTH_QUESTIONS.map((question) => [
    question.id,
    {
      type: "string" as const,
      description: `${question.chat.replace(/^- /, "Tratamientos odontológicos ")}: "si" o "no", según respondió. Solo si lo respondió.`,
      enum: YES_NO,
    },
  ]),
);
const yesNoSchema = z.string().trim().toLowerCase().transform((v) => v.normalize("NFD").replace(/\p{Diacritic}/gu, "")).pipe(z.enum(YES_NO));

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "buscar_paciente",
    description:
      "Con un paciente (no con el equipo: para eso es equipo_buscar_pacientes). Busca la ficha de quien te escribe y dice (o da a entender) que ya es paciente, cuando el contexto no trae su ficha: escribe desde otro número o por la web. Necesitás su DNI y su nombre y apellido: si ya te los dijo, usala enseguida sin volver a pedírselos. Solo si hace falta te va a pedir la fecha de nacimiento. Para un turno existente mandá para_turno_existente=true en cada intento. Si devuelve solo_turnos, continuá con ver_turnos_paciente y gestioná solo el turno pedido.",
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
      "Con un paciente (para que el equipo cree la ficha de otra persona es equipo_crear_paciente). Guarda o actualiza los datos del paciente con el que estás hablando (nombre, DNI, cobertura, etc.). Usala para admisión de un turno nuevo o cuando el paciente quiere actualizar sus datos. Para encontrar, mover o cancelar un turno existente, usá buscar_paciente y ver_turnos_paciente sin registrar otra ficha.",
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
      "Busca horarios libres reales para reservar (tipo_turno_id) o mover un turno existente (turno_id). Usala SIEMPRE antes de ofrecer horarios. Si el paciente pide una hora concreta, pasá hora_exacta y usá hora_solicitada.disponible para saber si se puede ofrecer. Filtra por cobertura, y con un turno de urgencia busca hoy y mañana. Si trae aviso_cobertura, decíselo antes de ofrecer. Si trae preguntar_antes, preguntalo antes de reservar.",
    params: {
      tipo_turno_id: { type: "string", description: "Para reservar: id del tipo de turno, copiado del catálogo." },
      turno_id: { type: "string", description: "Para reprogramar: turno_id del turno existente (si son dos prácticas seguidas, usá el de la primera)." },
      segundo_tipo_turno_id: { type: "string", description: SECOND_TYPE },
      profesional_id: { type: "string", description: "id del profesional si el paciente pidió uno en particular." },
      desde: { type: "string", description: `Primer día a buscar. ${isoDate} Por defecto, hoy.` },
      hasta: { type: "string", description: `Último día a buscar. ${isoDate} Por defecto, dos semanas después de 'desde'.` },
      hora_exacta: { type: "string", description: "Hora concreta que pidió el paciente, en hora local (HH:MM, 24 h), por ejemplo 15:00. Si pidió un día específico, mandá ese mismo día en desde y hasta." },
      franja: { type: "string", description: "Franja horaria preferida.", enum: ["manana", "tarde", "cualquiera"] },
      cobertura: {
        type: "string",
        description: "Solo si el paciente se va a atender con otra cobertura que la de su ficha (por ejemplo, 'Particular'). Si no, se usa la de la ficha.",
      },
      paciente_id: PATIENT_PARAM,
    },
    schema: z.object({
      paciente_id: z.string().optional(),
      tipo_turno_id: z.string().min(1).optional(),
      turno_id: z.string().min(1).optional(),
      segundo_tipo_turno_id: z.string().optional(),
      profesional_id: z.string().optional(),
      desde: z.string().optional(),
      hasta: z.string().optional(),
      hora_exacta: z.string().trim().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(),
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
      paciente_id: PATIENT_PARAM,
    },
    schema: z.object({
      paciente_id: z.string().optional(),
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
    params: { paciente_id: PATIENT_PARAM },
    schema: z.object({ paciente_id: z.string().optional() }),
  },
  {
    name: "consultar_estado_turno",
    description: "Consulta el resultado de una reserva, cancelación o reprogramación pendiente. Por teléfono usala una vez después de que la gestión devuelva pendiente_confirmacion, antes de despedirte. No vuelve a ejecutar el cambio.",
    params: {
      turno_id: { type: "string", description: "El turno_id que devolvió la gestión pendiente, aunque luego haya sido reemplazado al moverlo.", required: true },
    },
    schema: z.object({ turno_id: z.string().min(1) }),
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
    description: "Anota al paciente en lista de espera para adelantar un turno que ya tiene reservado: usá turno_id (también si figura como Turno Smile Connect). Conserva ese turno. Si todavía no tiene turno, primero reservale el primer horario que le sirva y después anotalo con el turno_id de esa reserva. tipo_turno_id con sin_turno solo si no hubo ningún horario o no quiso ninguno. Confirmá que quedó anotado solo si devuelve éxito.",
    params: {
      tipo_turno_id: { type: "string", description: "Solo sin turno reservado (con sin_turno): id del tipo de turno." },
      turno_id: { type: "string", description: "Para mover uno existente: id de ese turno. No lo reemplaces por el tipo genérico importado." },
      profesional_id: { type: "string", description: "id del profesional, si quiere uno en particular." },
      preferencias: { type: "string", description: "Días y horarios que le sirven." },
      sin_turno: { type: "string", description: "Solo con tipo_turno_id: por qué queda en lista de espera sin turno reservado.", enum: ["no_hay_horarios", "no_quiere_turno"] },
    },
    schema: z.object({ tipo_turno_id: z.string().min(1).optional(), turno_id: z.string().min(1).optional(), profesional_id: z.string().optional(), preferencias: z.string().optional(),
      sin_turno: z.enum(["no_hay_horarios", "no_quiere_turno"]).optional() })
      .refine((i) => Boolean(i.tipo_turno_id) !== Boolean(i.turno_id), "Usá tipo_turno_id o turno_id, solo uno."),
  },
  {
    name: "guardar_ficha_salud",
    description:
      "Guarda la ficha de salud que el paciente completó por chat (la plantilla que le mandaste), entera o en partes. Mandá solo lo que respondió: cada pregunta con \"si\" o \"no\". Si devolvió la lista, resto_no=true: lo que no marcó con SI es NO. Sin respuestas, te devuelve la plantilla para mandársela (por ejemplo, si pide completar la ficha). Te dice si quedó completa o qué falta.",
    params: {
      ...healthQuestionParams,
      resto_no: {
        type: "boolean",
        description: "true si el paciente devolvió la lista de la ficha: todo lo que no marcó con SI queda en NO (también la bioseguridad).",
      },
      embarazo_meses: { type: "string", description: "Si está embarazada: de cuántos meses." },
      hepatitis_cual: { type: "string", description: "Si tuvo hepatitis: cuál (A, B, C…), si lo dijo." },
      otros: { type: "string", description: "Tratamientos médicos, medicamentos o enfermedades que no están en la lista, con sus palabras." },
      bioseguridad: { type: "string", description: "Si quiere conocer las normas de bioseguridad del consultorio: \"si\" o \"no\".", enum: YES_NO },
      apellido: { type: "string", description: "Apellido o apellidos del paciente, separados de los nombres (también si ya lo tenías en el nombre completo)." },
      nombres: { type: "string", description: "Nombre o nombres de pila del paciente." },
      tipo_documento: { type: "string", description: "Solo si no es DNI (pasaporte, cédula…)." },
      calle: { type: "string", description: "Calle del domicilio particular." },
      numero: { type: "string", description: "Número de la calle." },
      piso: { type: "string", description: "Piso, si tiene." },
      dpto: { type: "string", description: "Departamento, si tiene." },
      localidad: { type: "string", description: "Localidad o barrio." },
      fecha_nacimiento: { type: "string", description: isoDate },
      email: { type: "string", description: "Mail, si lo dio en la ficha." },
    },
    schema: z.object({
      ...Object.fromEntries(HEALTH_QUESTIONS.map((question) => [question.id, yesNoSchema.optional()])),
      resto_no: z.boolean().optional(),
      embarazo_meses: z.string().optional(),
      hepatitis_cual: z.string().optional(),
      otros: z.string().optional(),
      bioseguridad: yesNoSchema.optional(),
      apellido: z.string().optional(),
      nombres: z.string().optional(),
      tipo_documento: z.string().optional(),
      calle: z.string().optional(),
      numero: z.string().optional(),
      piso: z.string().optional(),
      dpto: z.string().optional(),
      localidad: z.string().optional(),
      fecha_nacimiento: z.string().optional(),
      email: z.string().optional(),
    }),
  },
  {
    name: "silenciar_numero",
    description:
      "Solo por chat. Para quien no es paciente y escribe para vender algo al consultorio, publicidad no pedida, bots y mensajes automáticos (menús numerados, «soy un asistente virtual»). Contestale una sola vez que este WhatsApp es para turnos de pacientes y usá esto: no te llegan sus mensajes por 7 días. Nunca con un paciente ni si tenés dudas.",
    params: {
      motivo: { type: "string", description: "vendedor (ofrece algo al consultorio) o bot (mensajes automáticos).", enum: ["vendedor", "bot"], required: true },
      detalle: { type: "string", description: "Qué ofrecía o qué decía, en pocas palabras." },
    },
    schema: z.object({ motivo: z.enum(["vendedor", "bot"]), detalle: z.string().max(300).optional() }),
  },
  // Equipo del consultorio (acceso total por WhatsApp).
  {
    name: "ver_lista_espera",
    description: `${STAFF} Lee ahora la lista de espera de la clínica, incluidas las altas de hoy: pacientes, celulares, prestación, profesional, preferencias, estado y turno que conservan. Usala cada vez que pregunte por la lista; no respondas de memoria. Por defecto trae todas las inscripciones pendientes, activas y ofrecidas, sin límite de fecha. Tiene páginas de 30: seguí siguiente_pagina para una lista completa. No agrega ni avisa a pacientes.`,
    params: {
      desde: { type: "string", description: `Filtrar por fecha de inscripción, inclusive. ${isoDate} Para las altas de hoy, usá la fecha de hoy de la clínica; para la lista completa, omitilo.` },
      profesional_id: { type: "string", description: "id del profesional, solo si pide filtrar por uno." },
      estado: { type: "string", description: "Por defecto pendientes (activa y ofrecida). Todas incluye también resueltas y canceladas.", enum: ["pendientes", "activa", "ofrecida", "resuelta", "cancelada", "todas"] },
      pagina: { type: "number", description: "Número entero de página desde 1. Usá siguiente_pagina si la lista no entró completa." },
    },
    schema: z.object({ desde: z.string().optional(), profesional_id: z.string().optional(), estado: z.enum(["pendientes", "activa", "ofrecida", "resuelta", "cancelada", "todas"]).optional(), pagina: z.number().int().min(1).max(10000).optional() }),
  },
  {
    name: "ver_agenda",
    description: `${STAFF} Muestra los turnos de la agenda de uno o varios días (hasta 14), de toda la clínica o de un profesional, con su turno_id y paciente_id.`,
    params: {
      desde: { type: "string", description: `Primer día. ${isoDate} Por defecto, hoy.` },
      hasta: { type: "string", description: `Último día. ${isoDate} Por defecto, el mismo día.` },
      profesional_id: { type: "string", description: "id del profesional, si pide la agenda de uno solo." },
    },
    schema: z.object({ desde: z.string().optional(), hasta: z.string().optional(), profesional_id: z.string().optional() }),
  },
  {
    name: "detalle_turno",
    description: `${STAFF} Todo lo de un turno: quién lo dio y cuándo (vos por WhatsApp o llamada, el consultorio o Smile Connect), el paciente con DNI y celular, la prestación, la cobertura, lo que pidió y una nota lista para copiar en la agenda del consultorio. Para «¿este turno lo diste vos?».`,
    params: { turno_id: { type: "string", description: "turno_id de ver_agenda o de turnos_de_sofi.", required: true } },
    schema: z.object({ turno_id: z.string().min(1) }),
  },
  {
    name: "turnos_de_sofi",
    description: `${STAFF} Los turnos que diste, moviste y cancelaste desde un día (como el resumen diario de las 10), con una nota para copiar cada uno en la agenda del consultorio.`,
    params: { desde: { type: "string", description: `Desde qué día. ${isoDate} Por defecto, ayer.` } },
    schema: z.object({ desde: z.string().optional() }),
  },
  {
    name: "equipo_buscar_pacientes",
    description: `${STAFF} Busca pacientes por nombre, DNI o celular y devuelve su paciente_id, cobertura y próximos turnos. No es buscar_paciente (esa es para que un paciente se identifique).`,
    params: { texto: { type: "string", description: "Nombre, apellido, DNI o celular.", required: true } },
    schema: z.object({ texto: z.string().min(1) }),
  },
  {
    name: "equipo_crear_paciente",
    description: `${STAFF} Crea la ficha de otra persona que todavía no es paciente, para darle un turno. Devuelve su paciente_id. No es registrar_paciente (esa guarda los datos de quien te escribe).`,
    params: {
      nombre_completo: { type: "string", description: "Nombre y apellido.", required: true },
      celular: { type: "string", description: "Celular del paciente, si lo sabe." },
      dni: { type: "string", description: "DNI, solo números." },
      cobertura: { type: "string", description: "Obra social o prepaga, o 'Particular'." },
      plan: { type: "string", description: "Plan de la cobertura." },
    },
    schema: z.object({ nombre_completo: z.string().min(1), celular: z.string().optional(), dni: z.string().optional(), cobertura: z.string().optional(), plan: z.string().optional() }),
  },
  {
    name: "bloquear_agenda",
    description: `${STAFF} Bloquea la agenda (feriado, vacaciones, un rato sin atender) de toda la clínica o de un profesional: Sofi deja de ofrecer turnos ahí. Los turnos ya dados no se cancelan solos. Confirmá antes de bloquear.`,
    params: {
      desde: { type: "string", description: `Primer día. ${isoDate}`, required: true },
      hasta: { type: "string", description: `Último día (inclusive). ${isoDate} Por defecto, el mismo día.` },
      hora_desde: { type: "string", description: "Hora de inicio HH:MM, si es solo una parte del día." },
      hora_hasta: { type: "string", description: "Hora de fin HH:MM, si es solo una parte del día." },
      profesional_id: { type: "string", description: "id del profesional; sin esto, bloquea toda la clínica." },
      motivo: { type: "string", description: "Motivo (feriado, vacaciones, congreso…): Sofi lo dice si un paciente pide ese día." },
    },
    schema: z.object({
      desde: z.string().min(1),
      hasta: z.string().optional(),
      hora_desde: z.string().optional(),
      hora_hasta: z.string().optional(),
      profesional_id: z.string().optional(),
      motivo: z.string().optional(),
    }),
  },
  {
    name: "ver_tareas",
    description: `${STAFF} Lista los pedidos al equipo que siguen abiertos (recetas, consultas, derivaciones…), los urgentes primero.`,
    params: {},
    schema: z.object({}),
  },
  {
    name: "resolver_tarea",
    description: `${STAFF} Cierra un pedido al equipo. Con respuesta, se la manda al paciente por WhatsApp: confirmá el texto antes.`,
    params: {
      tarea_id: { type: "string", description: "tarea_id de ver_tareas.", required: true },
      respuesta: { type: "string", description: "Lo que se le contesta al paciente, si hay que contestarle algo." },
    },
    schema: z.object({ tarea_id: z.string().min(1), respuesta: z.string().optional() }),
  },
  {
    name: "pausar_chat",
    description: `${STAFF} Pausa tus respuestas en el chat de WhatsApp de un paciente, para que le conteste el equipo desde el celular del consultorio sin que respondan los dos. Los avisos y confirmaciones de turnos siguen saliendo. Pasá el celular o el paciente_id (de equipo_buscar_pacientes o ver_agenda). Confirmá antes.`,
    params: {
      celular: { type: "string", description: "Celular del paciente, con código de área." },
      paciente_id: { type: "string", description: "paciente_id, si lo tenés en vez del celular." },
      horas: { type: "number", description: "Por cuántas horas: 1, 4, 24 o 72. Por defecto, 4." },
    },
    schema: z.object({ celular: z.string().optional(), paciente_id: z.string().optional(), horas: z.coerce.number().optional() }),
  },
  {
    name: "reactivar_chat",
    description: `${STAFF} Vuelve a contestar en el chat de WhatsApp de un paciente que estaba en pausa. Pasá el celular o el paciente_id.`,
    params: {
      celular: { type: "string", description: "Celular del paciente, con código de área." },
      paciente_id: { type: "string", description: "paciente_id, si lo tenés en vez del celular." },
    },
    schema: z.object({ celular: z.string().optional(), paciente_id: z.string().optional() }),
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

/**
 * Nombres anteriores de herramientas renombradas. Un agente de ElevenLabs que todavía no se actualizó
 * las sigue llamando con el nombre viejo: la ruta las atiende igual.
 */
export const TOOL_ALIASES: Record<string, string> = {
  buscar_pacientes: "equipo_buscar_pacientes",
  crear_paciente: "equipo_crear_paciente",
};

/** El nombre vigente de una herramienta (resuelve los nombres anteriores). */
export const currentToolName = (name: string) => TOOL_ALIASES[name] ?? name;

export function getToolDefinition(name: string): ToolDefinition | undefined {
  const current = currentToolName(name);
  return TOOL_DEFINITIONS.find((t) => t.name === current);
}
