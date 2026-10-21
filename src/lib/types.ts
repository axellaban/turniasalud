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
  elevenlabs_agent_id: string | null;
  elevenlabs_voice_id: string | null;
  templates: Record<string, string>;
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
  is_first_visit: boolean;
  active: boolean;
};

export type Schedule = {
  id: string;
  professional_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
};

export type Patient = {
  id: string;
  clinic_id: string;
  full_name: string | null;
  phone: string;
  dni: string | null;
  birth_date: string | null;
  email: string | null;
  coverage: string | null;
  coverage_plan: string | null;
  member_number: string | null;
  preferences: string | null;
  memory_summary: string | null;
  notes: string | null;
  last_contact_at: string | null;
  created_at: string;
};

export type AppointmentStatus = "confirmado" | "pendiente" | "cancelado" | "ausente" | "atendido" | "reprogramado";
export type AppointmentSource = "whatsapp" | "telefono" | "web" | "panel" | "campana";

export type Appointment = {
  id: string;
  clinic_id: string;
  patient_id: string;
  professional_id: string;
  appointment_type_id: string;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
  source: AppointmentSource;
  coverage: string | null;
  notes: string | null;
  reminder_sent_at: string | null;
  cancelled_at: string | null;
  created_at: string;
};

export type Conversation = {
  id: string;
  clinic_id: string;
  patient_id: string | null;
  campaign_id: string | null;
  elevenlabs_conversation_id: string | null;
  channel: "whatsapp" | "telefono" | "web";
  direction: "entrante" | "saliente";
  started_at: string;
  duration_secs: number | null;
  status: string | null;
  title: string | null;
  summary: string | null;
  intent: string | null;
  outcome: string | null;
  call_successful: string | null;
  transcript: Array<{ role: string; message: string | null; time_in_call_secs?: number }> | null;
  analysis: Record<string, unknown> | null;
  created_at: string;
};

export const TASK_TYPES = [
  "receta",
  "consulta_clinica",
  "resultados",
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

export const CAMPAIGN_TYPES = ["recall", "reactivacion", "recordatorio", "lista_espera", "no_show", "personalizada"] as const;
export type CampaignType = (typeof CAMPAIGN_TYPES)[number];

export type Campaign = {
  id: string;
  clinic_id: string;
  name: string;
  type: CampaignType;
  template_name: string;
  template_language: string;
  goal: string | null;
  status: "borrador" | "enviando" | "finalizada";
  created_at: string;
  sent_at: string | null;
};

export type CampaignRecipient = {
  id: string;
  campaign_id: string;
  patient_id: string;
  status: "pendiente" | "enviado" | "error" | "respondio" | "agendo";
  elevenlabs_conversation_id: string | null;
  error: string | null;
  sent_at: string | null;
};
