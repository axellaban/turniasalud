export type Clinic = {
  id: string;
  name: string;
  agent_name: string;
  specialty: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  timezone: string;
  hours_text: string | null;
  accepted_coverages: string[];
  faq: string | null;
  policies: string | null;
  urgency_instructions: string | null;
  whatsapp_phone_number_id: string | null;
  /** meta = WhatsApp oficial importado en ElevenLabs · waha = chip común con WAHA + Custom Channel. */
  whatsapp_provider: "meta" | "waha";
  elevenlabs_agent_id: string | null;
  elevenlabs_voice_id: string | null;
  templates: Record<string, string>;
  handoff_phone: string | null;
  after_hours_instructions: string | null;
  /** Clínica temporal de la demo del lead magnet (/probar-demo), armada con la web del interesado. */
  is_demo: boolean;
  demo_source_url: string | null;
  retained_at: string | null;
  updated_at: string;
  context_revision: number;
  payment_methods: string | null;
  agent_context: string | null;
  /** Meses sin venir para que un paciente cuente como inactivo (campaña de reactivación). */
  reactivation_months: number;
  /** Días mínimos entre dos campañas para volver a sacar turno al mismo paciente (0 = sin tope). */
  contact_cooldown_days: number;
  /** Veces que se le vuelve a escribir a quien no contestó los horarios que le ofreció el agente (0 a 2). */
  followup_attempts: number;
  /** Horas que se espera antes del primer seguimiento. */
  followup_delay_hours: number;
  /** Sofi no mueve turnos a los que les faltan menos de estas horas (vacío: sin mínimo). */
  reschedule_notice_hours: number | null;
  /** Sofi no cancela turnos a los que les faltan menos de estas horas (vacío: sin mínimo). */
  cancel_notice_hours: number | null;
  /** Las visitas más largas que esto las mueve recepción (vacío: sin tope). */
  reschedule_max_minutes: number | null;
  /** Al mover un turno se conserva la duración que tenía (y no la de su prestación). */
  keep_duration_on_reschedule: boolean;
  /** Palabras que, en el nombre, el título o las notas del turno, hacen que lo mueva recepción. */
  reception_only_terms: string | null;
  /** Sofi mueve también los turnos de prestaciones que da solo el consultorio. */
  move_panel_only: boolean;
  /** Cómo trata a los pacientes. Vacío: de vos, o lo que digan las instrucciones de la clínica. */
  tone: "vos" | "usted" | null;
  /** Usa el protocolo odontológico de Turnia (src/lib/agent/modules/odontologia.ts). */
  dental_protocol: boolean;
  /** Horas antes del turno en que las horas reservadas para urgencias quedan libres para todo. */
  urgent_release_hours: number | null;
  created_at: string;
};

export type Professional = {
  id: string;
  clinic_id: string;
  full_name: string;
  specialty: string;
  bio: string | null;
  accepted_coverages: string[] | null;
  active: boolean;
};

export type AppointmentType = {
  id: string;
  clinic_id: string;
  name: string;
  specialty: string;
  duration_min: number;
  instructions: string | null;
  recall_months: number | null;
  /** numeric de Postgres: llega como texto para no perder precisión. */
  price: string | null;
  is_first_visit: boolean;
  /** Solo la da el consultorio: el agente no la ofrece ni la reserva. */
  panel_only: boolean;
  /** Si el paciente ya tiene el turno, Sofi lo puede mover (si la da solo el consultorio, además, la clínica lo tiene que permitir). */
  agent_can_reschedule: boolean;
  /** Turno de urgencia: busca hoy y mañana, y puede usar las horas reservadas para urgencias. */
  is_urgent: boolean;
  /** Para reservarla, el paciente tiene que haber tenido (o tener reservada) esta otra prestación. */
  requires_type_id: string | null;
  /** Qué preguntar antes de reservar. */
  ask_before: string | null;
  /** Cómo dice el precio Sofi. */
  price_mode: PriceMode;
  active: boolean;
};

export const PRICE_MODES = ["referencia", "exacto", "desde", "no_informar"] as const;
export type PriceMode = (typeof PRICE_MODES)[number];

export type Schedule = {
  id: string;
  professional_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  /** Reservado para urgencias: solo lo usan los turnos de urgencia (y el consultorio). */
  urgent_only: boolean;
  /** Solo para estas prestaciones. Vacío: para todas las del profesional. */
  appointment_type_ids: string[] | null;
};

/** Qué prestaciones hace cada profesional. Sin filas, hace todas las de su especialidad. */
export type ProfessionalType = { professional_id: string; appointment_type_id: string };

export const COVERAGE_MODES = ["acepta", "copago", "reintegro", "no_acepta"] as const;
export type CoverageMode = (typeof COVERAGE_MODES)[number];

/** Una regla de la matriz de coberturas. Plan, prestación y profesional vacíos: valen para todos. */
export type CoverageRule = {
  id: string;
  clinic_id: string;
  coverage: string;
  plan: string | null;
  appointment_type_id: string | null;
  professional_id: string | null;
  mode: CoverageMode;
  /** numeric de Postgres: llega como texto. */
  copay: string | null;
  requires_authorization: boolean;
  note: string | null;
  created_at: string;
};

export type PatientSex = "femenino" | "masculino" | "otro";

export type Patient = {
  id: string;
  clinic_id: string;
  full_name: string | null;
  /** Celular o identificador histórico de contacto. Puede faltar y lo pueden compartir varias fichas (una familia). */
  phone: string | null;
  dni: string | null;
  birth_date: string | null;
  email: string | null;
  sex: PatientSex | null;
  address: string | null;
  coverage: string | null;
  coverage_plan: string | null;
  member_number: string | null;
  preferences: string | null;
  memory_summary: string | null;
  notes: string | null;
  /** Pidió no recibir mensajes de campañas (recall, reactivación, encuestas…). */
  contact_opt_out: boolean;
  last_contact_at: string | null;
  /** Control indicado para este paciente (AAAA-MM-DD): entra en el recall cuando llega la fecha. */
  next_control_at: string | null;
  next_control_reason: string | null;
  /** Importación que creó la ficha (para poder deshacerla). */
  import_id: string | null;
  created_at: string;
};

/** Visita anterior a Turnia, traída de la importación: cuenta como un turno atendido. */
export type PatientVisit = {
  id: string;
  clinic_id: string;
  patient_id: string;
  appointment_type_id: string | null;
  service: string;
  professional: string | null;
  visited_at: string;
  import_id: string | null;
  created_at: string;
};

export type AppointmentStatus = "confirmado" | "pendiente" | "cancelado" | "ausente" | "atendido" | "reprogramado";
export type AppointmentSource = "whatsapp" | "telegram" | "telefono" | "web" | "panel" | "campana" | "smile_connect";

export type Appointment = {
  id: string;
  clinic_id: string;
  patient_id: string;
  professional_id: string;
  /** Otro profesional que atiende el mismo turno (por ejemplo, una cirugía conjunta). */
  second_professional_id: string | null;
  appointment_type_id: string;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
  source: AppointmentSource;
  coverage: string | null;
  notes: string | null;
  /** Nombre propio del turno («Consulta de implantes»); vacío, se llama como su prestación. */
  title?: string | null;
  reminder_sent_at: string | null;
  confirmed_at: string | null;
  survey_sent_at: string | null;
  cancelled_at: string | null;
  external_id?: string | null;
  external_status?: string | null;
  created_at: string;
};

export type Conversation = {
  id: string;
  clinic_id: string;
  patient_id: string | null;
  campaign_id: string | null;
  elevenlabs_conversation_id: string | null;
  channel: "whatsapp" | "telegram" | "telefono" | "web";
  direction: "entrante" | "saliente";
  started_at: string;
  duration_secs: number | null;
  status: string | null;
  title: string | null;
  summary: string | null;
  intent: string | null;
  outcome: string | null;
  call_successful: string | null;
  satisfaction: number | null;
  transcript: Array<{ role: string; message: string | null; time_in_call_secs?: number }> | null;
  analysis: Record<string, unknown> | null;
  created_at: string;
};

export const TASK_TYPES = [
  "receta",
  "consulta_clinica",
  "resultados",
  "orden_medica",
  "administrativo",
  "derivacion_humana",
  "urgencia",
  "facturacion",
  "otro",
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_PRIORITIES = ["baja", "normal", "alta", "urgente"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export type Task = {
  id: string;
  clinic_id: string;
  patient_id: string | null;
  conversation_id: string | null;
  type: TaskType;
  priority: TaskPriority;
  status: "abierta" | "en_curso" | "resuelta";
  title: string;
  details: string | null;
  assigned_to: string | null;
  response: string | null;
  responded_at: string | null;
  created_at: string;
  resolved_at: string | null;
};

export type WaitlistEntry = {
  id: string;
  clinic_id: string;
  patient_id: string;
  appointment_type_id: string | null;
  professional_id: string | null;
  preferences: string | null;
  status: "activa" | "ofrecida" | "resuelta" | "cancelada";
  offered_at: string | null;
  created_at: string;
};

export const CAMPAIGN_TYPES = ["recall", "reactivacion", "recordatorio", "lista_espera", "no_show", "encuesta", "personalizada"] as const;
export type CampaignType = (typeof CAMPAIGN_TYPES)[number];

export type Campaign = {
  id: string;
  clinic_id: string;
  name: string;
  type: CampaignType;
  template_name: string;
  template_language: string;
  goal: string | null;
  /** Mensaje propio con {nombre} y {detalle} (por WAHA y desde el WhatsApp de la clínica); null = el sugerido. */
  message: string | null;
  /** borrador = lista para revisar · enviando = en curso (quedan pendientes) · finalizada = enviada a todos. */
  status: "borrador" | "enviando" | "finalizada";
  created_at: string;
  sent_at: string | null;
};

export type ScheduleBlock = {
  id: string;
  clinic_id: string;
  professional_id: string | null;
  starts_at: string;
  ends_at: string;
  reason: string | null;
  created_at: string;
};

export type CampaignRecipient = {
  id: string;
  campaign_id: string;
  patient_id: string;
  /** excluido = lo quitó el equipo, o dejó de cumplir las condiciones (el motivo queda en error). */
  status: "pendiente" | "enviado" | "error" | "respondio" | "agendo" | "excluido";
  elevenlabs_conversation_id: string | null;
  error: string | null;
  sent_at: string | null;
  detail: string | null;
  context: string | null;
  /** Precio de referencia del turno que se le ofrece (null si la prestación no tiene precio). */
  value: string | null;
  /** Lo envió el equipo desde su WhatsApp (chat abierto desde el panel con el mensaje escrito). */
  manual: boolean;
  created_at: string;
};
