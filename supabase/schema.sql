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
