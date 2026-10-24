-- Turnia Salud — esquema de base de datos (Postgres: Neon, Supabase o local)
-- Pegalo completo en el SQL Editor de Neon o Supabase → Run. Se puede correr
-- más de una vez: también actualiza bases creadas con versiones anteriores.

create extension if not exists btree_gist;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Clínica y configuración
-- ---------------------------------------------------------------------------
create table if not exists clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  agent_name text not null default 'Sofi',
  specialty text not null default 'Multiespecialidad',
  address text,
  phone text,
  website text,
  timezone text not null default 'America/Argentina/Buenos_Aires',
  hours_text text,
  accepted_coverages text[] not null default '{}',
  faq text,
  policies text,
  urgency_instructions text,
  whatsapp_phone_number_id text,
  elevenlabs_agent_id text,
  elevenlabs_voice_id text,
  templates jsonb not null default '{}'::jsonb,
  handoff_phone text,
  after_hours_instructions text,
  created_at timestamptz not null default now()
);

create table if not exists professionals (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  full_name text not null,
  specialty text not null,
  bio text,
  accepted_coverages text[],
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists appointment_types (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  name text not null,
  specialty text not null,
  duration_min integer not null default 30 check (duration_min between 5 and 480),
  instructions text,
  recall_months integer,
  price numeric(12, 2),
  is_first_visit boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Bloques de atención semanales por profesional (weekday: 0=domingo … 6=sábado)
create table if not exists schedules (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references professionals(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  check (end_time > start_time)
);

-- Feriados, vacaciones y bloqueos de agenda. Sin profesional = toda la clínica.
create table if not exists schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  professional_id uuid references professionals(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index if not exists schedule_blocks_clinic_idx on schedule_blocks (clinic_id, ends_at);

-- ---------------------------------------------------------------------------
-- Pacientes ("memoria del paciente")
-- ---------------------------------------------------------------------------
create table if not exists patients (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  full_name text,
  phone text not null,
  dni text,
  birth_date date,
  email text,
  coverage text,
  coverage_plan text,
  member_number text,
  preferences text,
  memory_summary text,
  notes text,
  contact_opt_out boolean not null default false,
  last_contact_at timestamptz,
  created_at timestamptz not null default now(),
  unique (clinic_id, phone)
);

-- ---------------------------------------------------------------------------
-- Turnos
-- ---------------------------------------------------------------------------
create table if not exists appointments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  professional_id uuid not null references professionals(id) on delete restrict,
  appointment_type_id uuid not null references appointment_types(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'confirmado'
    check (status in ('confirmado', 'pendiente', 'cancelado', 'ausente', 'atendido', 'reprogramado')),
  source text not null default 'panel'
    check (source in ('whatsapp', 'telefono', 'web', 'panel', 'campana')),
  coverage text,
  notes text,
  reminder_sent_at timestamptz,
  confirmed_at timestamptz,
  survey_sent_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

-- Nunca dos turnos activos superpuestos para el mismo profesional.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'appointments_no_overlap') then
    alter table appointments add constraint appointments_no_overlap
      exclude using gist (
        professional_id with =,
        tstzrange(starts_at, ends_at, '[)') with &&
      ) where (status in ('confirmado', 'pendiente'));
  end if;
end $$;

create index if not exists appointments_clinic_starts_idx on appointments (clinic_id, starts_at);
create index if not exists appointments_patient_idx on appointments (patient_id, starts_at);

-- ---------------------------------------------------------------------------
-- Conversaciones (WhatsApp, teléfono, web)
-- ---------------------------------------------------------------------------
create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  patient_id uuid references patients(id) on delete set null,
  campaign_id uuid,
  elevenlabs_conversation_id text unique,
  channel text not null default 'whatsapp' check (channel in ('whatsapp', 'telefono', 'web')),
  direction text not null default 'entrante' check (direction in ('entrante', 'saliente')),
  started_at timestamptz not null default now(),
  duration_secs integer,
  status text,
  title text,
  summary text,
  intent text,
  outcome text,
  call_successful text,
  satisfaction smallint check (satisfaction between 0 and 10),
  transcript jsonb,
  analysis jsonb,
  created_at timestamptz not null default now()
);

create index if not exists conversations_clinic_started_idx on conversations (clinic_id, started_at desc);

-- ---------------------------------------------------------------------------
-- Tareas para el equipo (recetas, consultas clínicas, derivaciones a humano…)
-- ---------------------------------------------------------------------------
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  patient_id uuid references patients(id) on delete set null,
  conversation_id text,
  type text not null default 'administrativo'
    check (type in ('receta', 'consulta_clinica', 'resultados', 'orden_medica', 'administrativo', 'derivacion_humana', 'urgencia', 'facturacion', 'otro')),
  priority text not null default 'normal' check (priority in ('baja', 'normal', 'alta', 'urgente')),
  status text not null default 'abierta' check (status in ('abierta', 'en_curso', 'resuelta')),
  title text not null,
  details text,
  assigned_to text,
  response text,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists tasks_clinic_status_idx on tasks (clinic_id, status, created_at desc);

-- ---------------------------------------------------------------------------
-- Lista de espera
-- ---------------------------------------------------------------------------
create table if not exists waitlist (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  appointment_type_id uuid references appointment_types(id) on delete set null,
  professional_id uuid references professionals(id) on delete set null,
  preferences text,
  status text not null default 'activa' check (status in ('activa', 'ofrecida', 'resuelta', 'cancelada')),
  offered_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Campañas salientes (recall, reactivación, recordatorios, lista de espera)
-- ---------------------------------------------------------------------------
create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  name text not null,
  type text not null
    check (type in ('recall', 'reactivacion', 'recordatorio', 'lista_espera', 'no_show', 'encuesta', 'personalizada')),
  template_name text not null,
  template_language text not null default 'es_AR',
  goal text,
  status text not null default 'borrador' check (status in ('borrador', 'enviando', 'finalizada')),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table if not exists campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  status text not null default 'pendiente'
    check (status in ('pendiente', 'enviado', 'error', 'respondio', 'agendo')),
  elevenlabs_conversation_id text,
  error text,
  sent_at timestamptz,
  unique (campaign_id, patient_id)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'conversations_campaign_fk') then
    alter table conversations add constraint conversations_campaign_fk
      foreign key (campaign_id) references campaigns(id) on delete set null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Actualización de bases creadas con versiones anteriores de este archivo.
-- Volver a correr el archivo completo es seguro: solo agrega lo que falta.
-- ---------------------------------------------------------------------------
alter table clinics add column if not exists handoff_phone text;
alter table clinics add column if not exists after_hours_instructions text;
alter table appointment_types add column if not exists price numeric(12, 2);
alter table patients add column if not exists contact_opt_out boolean not null default false;
alter table appointments add column if not exists confirmed_at timestamptz;
alter table appointments add column if not exists survey_sent_at timestamptz;
alter table conversations add column if not exists satisfaction smallint check (satisfaction between 0 and 10);
alter table tasks add column if not exists response text;
alter table tasks add column if not exists responded_at timestamptz;

alter table tasks drop constraint if exists tasks_type_check;
alter table tasks add constraint tasks_type_check
  check (type in ('receta', 'consulta_clinica', 'resultados', 'orden_medica', 'administrativo', 'derivacion_humana', 'urgencia', 'facturacion', 'otro'));
alter table campaigns drop constraint if exists campaigns_type_check;
alter table campaigns add constraint campaigns_type_check
  check (type in ('recall', 'reactivacion', 'recordatorio', 'lista_espera', 'no_show', 'encuesta', 'personalizada'));

-- ---------------------------------------------------------------------------
-- WhatsApp por WAHA (chip común, API no oficial) conectado al agente con el
-- Custom Channel de ElevenLabs. Con Meta (oficial) estas tablas no se usan.
-- ---------------------------------------------------------------------------
alter table clinics add column if not exists whatsapp_provider text not null default 'meta';
alter table clinics drop constraint if exists clinics_whatsapp_provider_check;
alter table clinics add constraint clinics_whatsapp_provider_check check (whatsapp_provider in ('meta', 'waha'));

-- Una fila por conversación de WhatsApp: a qué chat responder y en qué
-- conversación de ElevenLabs sigue. Se abre una nueva después de 15 minutos
-- sin mensajes o cuando el agente cierra la conversación (end_call).
create table if not exists channel_conversations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  phone text not null,
  chat_id text not null,
  elevenlabs_conversation_id text unique,
  campaign_id uuid references campaigns(id) on delete set null,
  context text,
  transcript jsonb not null default '[]'::jsonb,
  last_activity_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists channel_conversations_phone_idx on channel_conversations (clinic_id, phone, last_activity_at desc);

-- Mensajes ya procesados (WAHA y ElevenLabs reintentan los webhooks).
create table if not exists channel_events (
  key text primary key,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Seguridad: RLS activado y sin políticas. Solo el servidor, conectado con el
-- usuario dueño de las tablas (DATABASE_URL), lee y escribe. El navegador
-- nunca habla directo con la base.
-- ---------------------------------------------------------------------------
alter table clinics enable row level security;
alter table professionals enable row level security;
alter table appointment_types enable row level security;
alter table schedules enable row level security;
alter table patients enable row level security;
alter table appointments enable row level security;
alter table conversations enable row level security;
alter table tasks enable row level security;
alter table waitlist enable row level security;
alter table campaigns enable row level security;
alter table campaign_recipients enable row level security;
alter table schedule_blocks enable row level security;
alter table channel_conversations enable row level security;
alter table channel_events enable row level security;

-- ---------------------------------------------------------------------------
-- Web pública: pedidos de demo (formulario /pedi-una-demo).
-- ---------------------------------------------------------------------------
create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text,
  organization text,
  role text,
  specialty text,
  size text,
  message text,
  source text,
  created_at timestamptz not null default now()
);
create index if not exists leads_created_idx on leads (created_at desc);
alter table leads enable row level security;

-- Seguimiento comercial desde el panel. Conserva los pedidos existentes.
alter table leads add column if not exists status text not null default 'nuevo'
  check (status in ('nuevo', 'contactado', 'demo_agendada', 'ganado', 'descartado'));
alter table leads add column if not exists notes text;
alter table leads add column if not exists updated_at timestamptz not null default now();

-- ---------------------------------------------------------------------------
-- Web pública: audios de las demos, generados desde Panel → Configuración.
-- ---------------------------------------------------------------------------
create table if not exists web_audios (
  slug text primary key,
  mp3 bytea not null,
  sync jsonb not null,
  voices jsonb,
  created_at timestamptz not null default now()
);
alter table web_audios enable row level security;

-- ---------------------------------------------------------------------------
-- Lead magnet "Probá la demo con tu web" (/probar-demo). La persona manda su
-- web por WhatsApp, Turnia la lee y arma una clínica temporal (is_demo) con
-- sus datos; el agente la atiende como la recepcionista de ese consultorio por
-- llamada, audios o chat. Las clínicas de demo se borran a los 7 días.
-- ---------------------------------------------------------------------------
alter table clinics add column if not exists is_demo boolean not null default false;
alter table clinics add column if not exists demo_source_url text;
alter table channel_conversations add column if not exists reply_with_voice boolean not null default false;
-- Los interesados que llegan por WhatsApp no dejan email.
alter table leads alter column email drop not null;

create table if not exists demo_sessions (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  chat_id text not null,
  website text not null,
  status text not null default 'analizando'
    check (status in ('analizando', 'eligiendo', 'llamada', 'audio', 'chat', 'terminada', 'error')),
  clinic_id uuid references clinics(id) on delete set null,
  lead_id uuid references leads(id) on delete set null,
  -- Link de la llamada por la web cuando no hay número de teléfono para llamar.
  call_token text unique,
  pages_read integer,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Idempotencia del mensaje original y reclamo único del análisis en segundo plano.
alter table demo_sessions add column if not exists request_message_id text;
alter table demo_sessions add column if not exists analysis_started_at timestamptz;
alter table demo_sessions add column if not exists call_attempts integer not null default 0;
create unique index if not exists demo_sessions_request_idx on demo_sessions (phone, request_message_id);
create index if not exists demo_sessions_phone_idx on demo_sessions (phone, updated_at desc);
alter table demo_sessions enable row level security;

-- Selector operativo global. Ningún despliegue reactiva WhatsApp automáticamente.
create table if not exists messaging_settings (
  id boolean primary key default true check (id),
  active_channel text not null default 'pausado' check (active_channel in ('pausado', 'telegram', 'whatsapp')),
  revision integer not null default 0,
  telegram_ready boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into messaging_settings (id) values (true) on conflict do nothing;
alter table messaging_settings enable row level security;
alter table channel_conversations add column if not exists channel_revision integer not null default 0;
alter table demo_sessions add column if not exists channel_revision integer not null default 0;

-- Token opaco de la landing: conserva la URL sin sobrepasar los 64 caracteres de /start.
create table if not exists demo_handoffs (
  token text primary key,
  website text not null,
  requester_hash text not null,
  claimed_by text,
  expires_at timestamptz not null default now() + interval '15 minutes',
  created_at timestamptz not null default now()
);
create index if not exists demo_handoffs_requester_idx on demo_handoffs (requester_hash, created_at);
alter table demo_handoffs enable row level security;

alter table conversations drop constraint if exists conversations_channel_check;
alter table conversations add constraint conversations_channel_check check (channel in ('whatsapp', 'telegram', 'telefono', 'web'));

alter table appointments drop constraint if exists appointments_source_check;
alter table appointments add constraint appointments_source_check check (source in ('whatsapp', 'telegram', 'telefono', 'web', 'panel', 'campana'));

-- Perfiles editables: conservar una demo mantiene su agenda simulada.
alter table clinics add column if not exists retained_at timestamptz;
alter table clinics add column if not exists updated_at timestamptz not null default now();
alter table clinics add column if not exists context_revision integer not null default 0;
alter table clinics add column if not exists payment_methods text;
alter table clinics add column if not exists agent_context text;
alter table demo_sessions add column if not exists reused_profile boolean not null default false;
alter table demo_handoffs add column if not exists clinic_id uuid references clinics(id) on delete cascade;
-- Email que deja el interesado en /probar-demo antes de pasar a Telegram o WhatsApp.
alter table demo_handoffs add column if not exists email text;
-- Los enlaces de perfil del panel valen 7 días y se pueden reutilizar (idempotente: no acorta ninguno).
update demo_handoffs set expires_at = created_at + interval '7 days'
  where clinic_id is not null and expires_at < created_at + interval '7 days';

-- Referencias de cada lectura: texto realmente leído y ficha propuesta, sin HTML ejecutable.
create table if not exists clinic_imports (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  source_url text not null,
  status text not null check (status in ('reading', 'pending', 'applied', 'discarded', 'error')),
  pages jsonb not null default '[]',
  profile jsonb,
  error text,
  created_at timestamptz not null default now(),
  applied_at timestamptz
);
create index if not exists clinic_imports_clinic_idx on clinic_imports (clinic_id, created_at desc);
create unique index if not exists clinic_imports_reading_idx on clinic_imports (clinic_id) where status = 'reading';
alter table clinic_imports enable row level security;
alter table clinic_imports add column if not exists started_at timestamptz;

-- Acceso propio de un consultorio: un código que solo abre su clínica en el panel.
-- Se guarda únicamente el hash del código; el código completo se muestra una vez.
create table if not exists clinic_access (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  label text,
  code_hash text not null unique,
  code_hint text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists clinic_access_clinic_idx on clinic_access (clinic_id, created_at desc);
alter table clinic_access enable row level security;

-- Revisión de la ficha con la que arrancó cada charla: si la clínica cambia, el agente
-- arranca otra conversación con los datos nuevos. Null en las anteriores: siguen igual.
alter table channel_conversations add column if not exists context_revision integer;

-- Intentos fallidos de ingreso al panel (hash del origen, sin la IP en claro).
create table if not exists login_failures (
  id bigint generated always as identity primary key,
  requester_hash text not null,
  created_at timestamptz not null default now()
);
create index if not exists login_failures_requester_idx on login_failures (requester_hash, created_at);
alter table login_failures enable row level security;

-- Quién cambió qué de cada ficha (el administrador o el consultorio con su código).
create table if not exists clinic_changes (
  id bigint generated always as identity primary key,
  clinic_id uuid not null references clinics(id) on delete cascade,
  actor text not null,
  area text not null,
  created_at timestamptz not null default now()
);
create index if not exists clinic_changes_clinic_idx on clinic_changes (clinic_id, created_at desc);
alter table clinic_changes enable row level security;

-- Demos por persona por día desde la landing o el chat. Null = sin límite (se ajusta en Sistema).
alter table messaging_settings add column if not exists demo_daily_limit integer;
