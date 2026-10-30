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
-- Demo sin web (/probar-demo?nombre=…): se arma con el nombre, la dirección y la especialidad del consultorio.
alter table demo_sessions add column if not exists manual_name text;
alter table demo_sessions add column if not exists manual_address text;
alter table demo_sessions add column if not exists manual_specialty text;
-- Link de la prospección: la demo sin web da turnos con el nombre del odontólogo.
alter table demo_sessions add column if not exists manual_professional text;
-- Y los tratamientos que declara (Doctoralia): suman sus turnos a la demo (implantes, ortodoncia…).
alter table demo_sessions add column if not exists manual_services text;
-- La persona de PostHog que empezó la demo en el navegador: los eventos del servidor (preparación,
-- conversaciones) quedan en su recorrido. Las de WhatsApp o Telegram no la tienen.
alter table demo_sessions add column if not exists analytics_id text;
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

-- ---------------------------------------------------------------------------
-- Google Calendar: una cuenta conectada por clínica y un calendario por profesional.
-- Turnia sigue siendo la dueña de sus turnos (no se pisan dos reservas); de Google
-- toma lo ocupado y le escribe cada turno al calendario del profesional.
-- ---------------------------------------------------------------------------
create table if not exists calendar_connections (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null unique references clinics(id) on delete cascade,
  provider text not null default 'google' check (provider in ('google')),
  account_email text,
  -- Cifrados con AES-256-GCM (src/lib/calendar/crypto.ts): nunca en texto plano.
  refresh_token text not null,
  access_token text,
  access_expires_at timestamptz,
  status text not null default 'conectado' check (status in ('conectado', 'error')),
  last_error text,
  last_sync_at timestamptz,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table calendar_connections enable row level security;

alter table professionals add column if not exists google_calendar_id text;
alter table professionals add column if not exists google_calendar_name text;
-- Lo ocupado del calendario del profesional, leído hace poco (evita esperar a Google en cada consulta).
alter table professionals add column if not exists google_busy jsonb;
alter table professionals add column if not exists google_busy_from timestamptz;
alter table professionals add column if not exists google_busy_to timestamptz;
alter table professionals add column if not exists google_busy_at timestamptz;

-- Estado del evento de cada turno en el calendario del profesional.
alter table appointments add column if not exists calendar_event_id text;
alter table appointments add column if not exists calendar_event_calendar text;
alter table appointments add column if not exists calendar_sync text;
alter table appointments add column if not exists calendar_error text;
alter table appointments add column if not exists calendar_attempts integer not null default 0;
alter table appointments drop constraint if exists appointments_calendar_sync_check;
alter table appointments add constraint appointments_calendar_sync_check check (calendar_sync is null or calendar_sync in ('pendiente', 'ok', 'error'));
create index if not exists appointments_calendar_pending_idx on appointments (clinic_id) where calendar_sync in ('pendiente', 'error');

-- Cualquier alta o cambio de un turno (agente, panel, campañas) deja su evento pendiente
-- de sincronizar, sin depender de que cada camino del código se acuerde de avisar.
create or replace function turnia_calendar_mark() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status or new.starts_at is distinct from old.starts_at
     or new.ends_at is distinct from old.ends_at or new.professional_id is distinct from old.professional_id then
    if new.calendar_event_id is not null or exists (
      select 1 from professionals p join calendar_connections c on c.clinic_id = p.clinic_id
      where p.id = new.professional_id and p.google_calendar_id is not null
    ) then
      new.calendar_sync := 'pendiente';
      new.calendar_attempts := 0;
      new.calendar_error := null;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists appointments_calendar_mark on appointments;
create trigger appointments_calendar_mark before insert or update on appointments
  for each row execute function turnia_calendar_mark();

-- Ventas de Turnia: separado de pacientes, turnos y campañas clínicas.
create table if not exists sales_settings (
  id smallint primary key check (id = 1),
  agent_id text,
  voice_id text,
  tool_ids text[] not null default '{}',
  enabled boolean not null default false,
  budget_date date,
  budget_cents integer not null default 0 check (budget_cents between 0 and 10000),
  updated_at timestamptz not null default now()
);
insert into sales_settings (id) values (1) on conflict do nothing;
alter table sales_settings enable row level security;

alter table sales_settings add column if not exists first_message text;
alter table sales_settings add column if not exists system_prompt text;
alter table sales_settings add column if not exists config_version integer not null default 0;
alter table sales_settings add column if not exists applied_at timestamptz;
alter table sales_settings add column if not exists needs_sync boolean not null default false;

create table if not exists sales_config_versions (
  version integer primary key,
  first_message text not null,
  system_prompt text not null,
  voice_id text not null,
  source text not null,
  created_at timestamptz not null default now()
);
alter table sales_config_versions enable row level security;

create table if not exists sales_prospects (
  id uuid primary key default gen_random_uuid(),
  business_name text not null,
  phone text not null check (phone ~ '^\+54[0-9]{10,11}$'),
  website text not null,
  context text not null default '',
  eligibility text not null default 'sin_revisar' check (eligibility in ('sin_revisar', 'solicito_llamada', 'no_llame_revisado')),
  evidence text not null default '',
  reviewed_at timestamptz,
  outcome text,
  notes text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists sales_prospects_phone_idx on sales_prospects (phone);
alter table sales_prospects enable row level security;

create table if not exists sales_calls (
  id uuid primary key default gen_random_uuid(),
  request_key uuid not null unique,
  prospect_id uuid not null references sales_prospects(id),
  agent_id text not null,
  phone text not null,
  business_name text not null,
  context text not null,
  budget_date date not null,
  reserved_cents integer not null default 100 check (reserved_cents = 100),
  status text not null default 'iniciando' check (status in ('iniciando','en_curso','completada','fallida','incierta')),
  conversation_id text unique,
  duration_secs integer,
  credits integer,
  transcript jsonb,
  summary text,
  outcome text,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists sales_calls_budget_idx on sales_calls (budget_date);
create index if not exists sales_calls_prospect_idx on sales_calls (prospect_id, created_at desc);
alter table sales_calls enable row level security;
alter table sales_calls add column if not exists config_version integer not null default 0;

create table if not exists sales_suppressions (
  phone text primary key,
  reason text not null,
  source_call_id uuid references sales_calls(id),
  created_at timestamptz not null default now()
);
alter table sales_suppressions enable row level security;

-- ---------------------------------------------------------------------------
-- Campañas para activar la base: historial que trae la clínica de su sistema anterior,
-- controles indicados por paciente, reglas de contacto y audiencia que se revisa antes de enviar.
-- ---------------------------------------------------------------------------
-- Cada importación de pacientes (Excel o CSV que exporta la clínica).
create table if not exists patient_imports (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  source text,
  actor text not null,
  rows_total integer not null default 0,
  created_patients integer not null default 0,
  updated_patients integer not null default 0,
  visits integer not null default 0,
  skipped integer not null default 0,
  created_at timestamptz not null default now(),
  undone_at timestamptz
);
create index if not exists patient_imports_clinic_idx on patient_imports (clinic_id, created_at desc);
alter table patient_imports enable row level security;

-- Visitas anteriores a Turnia: cuentan como turnos atendidos para el recall y la reactivación.
create table if not exists patient_visits (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  appointment_type_id uuid references appointment_types(id) on delete set null,
  service text not null default '',
  professional text,
  visited_at date not null,
  import_id uuid references patient_imports(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (patient_id, visited_at, service)
);
create index if not exists patient_visits_clinic_idx on patient_visits (clinic_id, patient_id, visited_at desc);
alter table patient_visits enable row level security;

-- Control indicado para un paciente puntual ("volvé en 3 meses"); la importación que lo creó.
alter table patients add column if not exists next_control_at date;
alter table patients add column if not exists next_control_reason text;
alter table patients add column if not exists import_id uuid references patient_imports(id) on delete set null;

-- Reglas de contacto: cuándo un paciente cuenta como inactivo y cada cuántos días, como mucho,
-- se le escribe para que vuelva a sacar turno.
alter table clinics add column if not exists reactivation_months integer not null default 12;
alter table clinics add column if not exists contact_cooldown_days integer not null default 30;
alter table clinics drop constraint if exists clinics_reactivation_months_check;
alter table clinics add constraint clinics_reactivation_months_check check (reactivation_months between 3 and 60);
alter table clinics drop constraint if exists clinics_contact_cooldown_days_check;
alter table clinics add constraint clinics_contact_cooldown_days_check check (contact_cooldown_days between 0 and 365);

-- La audiencia queda guardada al crear la campaña: se revisa, se quita a quien no corresponde y se envía.
alter table campaign_recipients add column if not exists detail text;
alter table campaign_recipients add column if not exists context text;
alter table campaign_recipients add column if not exists value numeric(12, 2);
alter table campaign_recipients add column if not exists created_at timestamptz not null default now();
alter table campaign_recipients drop constraint if exists campaign_recipients_status_check;
alter table campaign_recipients add constraint campaign_recipients_status_check
  check (status in ('pendiente', 'enviado', 'error', 'respondio', 'agendo', 'excluido'));
create index if not exists campaign_recipients_patient_idx on campaign_recipients (patient_id, sent_at desc);
-- Mensaje propio de la campaña ({nombre} y {detalle}); por Meta se sigue usando el template aprobado.
alter table campaigns add column if not exists message text;
-- Enviado a mano desde el WhatsApp de la clínica (botón que abre el chat con el mensaje escrito).
alter table campaign_recipients add column if not exists manual boolean not null default false;

-- ---------------------------------------------------------------------------
-- Prospección: odontólogos a los que Axel les escribe a mano (WhatsApp, Instagram, llamada o
-- visita), cada uno con su link de demo (/p/<código>). Separado de las llamadas de Sofi.
-- ---------------------------------------------------------------------------
create table if not exists sales_outreach (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9][a-z0-9-]{2,39}$'),
  name text not null,
  greeting text not null default '',
  title text not null default '',
  business_name text not null default '',
  zone text not null default '',
  address text not null default '',
  specialty text not null default '',
  phone text check (phone is null or phone ~ '^\+54[0-9]{10,11}$'),
  phone_kind text check (phone_kind in ('movil', 'consultorio', 'fijo')),
  instagram text,
  email text,
  website text,
  priority smallint not null default 2 check (priority between 1 and 3),
  signals text not null default '',
  source text not null default '',
  status text not null default 'por_contactar'
    check (status in ('por_contactar', 'contactado', 'respondio', 'reunion', 'cliente', 'no_interesa', 'sin_canal', 'baja')),
  touches smallint not null default 0,
  last_channel text,
  first_contact_at timestamptz,
  last_contact_at timestamptz,
  next_action_on date,
  opened_at timestamptz,
  opens integer not null default 0,
  demo_at timestamptz,
  lead_id uuid references leads(id) on delete set null,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sales_outreach_queue_idx on sales_outreach (status, next_action_on, priority);
create index if not exists sales_outreach_phone_idx on sales_outreach (phone);
alter table sales_outreach enable row level security;
-- «consultorio»: el celular del consultorio, el WhatsApp que figura en su web (lo lee la recepción).
alter table sales_outreach drop constraint if exists sales_outreach_phone_kind_check;
alter table sales_outreach add constraint sales_outreach_phone_kind_check check (phone_kind in ('movil', 'consultorio', 'fijo'));
-- El saludo de WhatsApp sin link («¡Buenas! ¿Hablo con…?») va antes de la presentación con la demo,
-- para que WhatsApp no bloquee el número. No cuenta como toque.
alter table sales_outreach add column if not exists greeted_at timestamptz;

-- Historia de cada contacto: mensajes, llamadas, visitas, respuestas, cambios de estado y la demo.
create table if not exists sales_outreach_events (
  id uuid primary key default gen_random_uuid(),
  outreach_id uuid not null references sales_outreach(id) on delete cascade,
  kind text not null check (kind in ('mensaje', 'llamada', 'visita', 'estado', 'nota', 'abrio', 'demo')),
  channel text,
  detail text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists sales_outreach_events_idx on sales_outreach_events (outreach_id, created_at desc);
create index if not exists sales_outreach_events_day_idx on sales_outreach_events (created_at) where kind = 'mensaje';
alter table sales_outreach_events enable row level security;

-- La vista previa de su link en WhatsApp, ya armada: armarla tarda 2 a 4 s y WhatsApp no espera
-- (src/lib/sales/demo-preview.ts). `version` cambia con los datos que muestra o con el dibujo.
create table if not exists sales_outreach_previews (
  outreach_id uuid primary key references sales_outreach(id) on delete cascade,
  version text not null,
  image bytea not null,
  created_at timestamptz not null default now()
);
alter table sales_outreach_previews enable row level security;
-- 29/10/2026: pasan a JPEG (pesan un cuarto); la columna deja de llamarse png.
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sales_outreach_previews' and column_name = 'png') then
    alter table sales_outreach_previews rename column png to image;
  end if;
end $$;

-- Cambios de datos que corren una sola vez (el esquema se aplica en cada deploy).
create table if not exists data_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);
alter table data_migrations enable row level security;

-- 28/10/2026: toda la prospección vuelve a «Por contactar» para empezar de nuevo con el saludo sin
-- link. Se borran los contactos y cambios de estado registrados (queda una nota con lo que había);
-- se conservan los datos, las notas y si abrió o probó su demo. Los que pidieron la baja siguen así.
do $$
begin
  if not exists (select 1 from data_migrations where name = '2026-10-28-prospeccion-por-contactar') then
    insert into sales_outreach_events (outreach_id, kind, detail)
    select id, 'nota', 'Se reinició la prospección: vuelve a «Por contactar» (antes: ' || status || ', ' || touches || ' mensajes).'
    from sales_outreach where status <> 'baja' and (status <> 'por_contactar' or touches > 0 or first_contact_at is not null);
    delete from sales_outreach_events e using sales_outreach o
    where e.outreach_id = o.id and o.status <> 'baja' and e.kind in ('mensaje', 'llamada', 'visita', 'estado');
    update sales_outreach set status = 'por_contactar', touches = 0, greeted_at = null, first_contact_at = null, last_contact_at = null,
      last_channel = null, next_action_on = null, updated_at = now()
    where status <> 'baja';
    insert into data_migrations (name) values ('2026-10-28-prospeccion-por-contactar');
  end if;
end $$;

-- Mensajes de la prospección (editables desde el panel) y metas de la semana.
alter table sales_settings add column if not exists outreach_templates jsonb not null default '{}'::jsonb;
alter table sales_settings add column if not exists outreach_daily_goal integer not null default 50;
alter table sales_settings add column if not exists outreach_weekly_goal integer not null default 250;

-- Pedidos de demo → Google Sheets: la URL de la aplicación web de Apps Script que el usuario
-- implementa en su planilla, y el resultado de la última copia.
alter table sales_settings add column if not exists leads_sheet_url text;
alter table sales_settings add column if not exists leads_sheet_name text;
alter table sales_settings add column if not exists leads_sheet_synced_at timestamptz;
alter table sales_settings add column if not exists leads_sheet_error text;

-- ---------------------------------------------------------------------------
-- Google Sheets: la planilla que Turnia mantiene al día en el Drive de quien conectó su cuenta
-- (src/lib/sheets/). owner = 'turnia' es la de prospección y pedidos de demo; más adelante, una por
-- clínica. Con el permiso drive.file Turnia solo ve las planillas que creó (o que le eligieron).
-- ---------------------------------------------------------------------------
create table if not exists sheets_connections (
  id uuid primary key default gen_random_uuid(),
  owner text not null unique,
  account_email text,
  -- Cifrados con AES-256-GCM (src/lib/calendar/crypto.ts): nunca en texto plano.
  refresh_token text not null,
  access_token text,
  access_expires_at timestamptz,
  spreadsheet_id text,
  spreadsheet_url text,
  status text not null default 'conectado' check (status in ('conectado', 'reconectar', 'sin_planilla')),
  last_error text,
  -- Una copia por vez: quién pidió copiar, quién está copiando y hasta cuándo quedó copiado.
  sync_requested_at timestamptz,
  sync_started_at timestamptz,
  last_sync_at timestamptz,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table sheets_connections enable row level security;

-- ---------------------------------------------------------------------------
-- Otros números de un mismo paciente. Cuando alguien que ya es paciente escribe
-- desde otro número (o desde la demo web) y se confirma quién es por DNI, ese
-- número queda apuntando a su ficha en lugar de crear una nueva.
-- ---------------------------------------------------------------------------
create table if not exists patient_phones (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  phone text not null,
  patient_id uuid not null references patients(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (clinic_id, phone)
);
create index if not exists patient_phones_patient_idx on patient_phones (patient_id);
alter table patient_phones enable row level security;

-- Buscar al paciente por DNI (agente y unificación de fichas repetidas).
create index if not exists patients_dni_idx on patients (clinic_id, dni) where dni is not null;

-- ---------------------------------------------------------------------------
-- Turno con dos profesionales (30/10/2026): por ejemplo, una cirugía que hacen
-- juntos. El turno queda en la agenda de los dos y ocupa el horario de ambos.
-- La constraint de superposición cubre al principal; el segundo lo controla la
-- app dentro de la transacción, con los locks por profesional.
-- ---------------------------------------------------------------------------
alter table appointments add column if not exists second_professional_id uuid references professionals(id) on delete restrict;
alter table appointments drop constraint if exists appointments_second_professional_check;
alter table appointments add constraint appointments_second_professional_check
  check (second_professional_id is null or second_professional_id <> professional_id);
create index if not exists appointments_second_professional_idx on appointments (second_professional_id, starts_at)
  where second_professional_id is not null;
