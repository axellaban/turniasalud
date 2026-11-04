import { getPanelClinic, getPanelUser } from "@/lib/panel-clinic";
import Link from "next/link";
import { sql } from "@/lib/db";
import { isConfigured } from "@/lib/env";
import { formatDateTime, formatTime, localDateKey, addDaysKey, zonedTimeToUtc } from "@/lib/time";
import { Badge, Card, CHANNEL_LABEL, Empty, Notice, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { profileCompleteness } from "@/lib/profile-completeness";
import { CompletenessCard } from "./completeness-card";
import { ACTIVITY_GUARANTEE, agentBookings, clinicGuarantee } from "@/lib/clinic-impact";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Inicio · Panel" };

export default async function PanelHome() {
  const configured = isConfigured();
  if (!configured.database) {
    return (
      <>
        <PageHeader title="¡Bienvenido a Turnia!" />
        <Card>
          <p className="text-sm text-brand-900/70">
            Falta conectar la base de datos. Completá la configuración de Neon o Supabase en Vercel y volvé a desplegar.
            La guía paso a paso está en el README del repositorio.
          </p>
        </Card>
      </>
    );
  }

  const [user, clinic] = await Promise.all([getPanelUser(), getPanelClinic()]);
  const completeness = await profileCompleteness(clinic);
  const tz = clinic.timezone;
  const now = new Date();
  const since = new Date(now.getTime() - 7 * 86400_000).toISOString();
  const todayKey = localDateKey(now, tz);
  const [y, m, d] = todayKey.split("-").map(Number);
  const dayStart = zonedTimeToUtc(y, m, d, 0, 0, tz).toISOString();
  const [ny, nm, nd] = addDaysKey(todayKey, 1).split("-").map(Number);
  const dayEnd = zonedTimeToUtc(ny, nm, nd, 0, 0, tz).toISOString();

  const month = new Date(now.getTime() - 30 * 86400_000).toISOString();
  const [[stats], [quality], [recovery], today, recentRows, urgentTasks] = await Promise.all([
    sql<Array<{ conversations: number; resolved: number; open_tasks: number }>>`
      select
        (select count(*)::int from conversations where clinic_id = ${clinic.id} and started_at >= ${since}) as conversations,
        (select count(*)::int from conversations where clinic_id = ${clinic.id} and started_at >= ${since} and outcome = 'resuelto') as resolved,
        (select count(*)::int from tasks where clinic_id = ${clinic.id} and status <> 'resuelta') as open_tasks`,
    // Últimos 30 días: satisfacción, confirmación de recordatorios y ausentismo.
    sql<Array<{ satisfaction: number | null; answers: number; reminded: number; confirmed: number; attended: number; absent: number }>>`
      select
        (select round(avg(satisfaction), 1)::float8 from conversations where clinic_id = ${clinic.id} and started_at >= ${month} and satisfaction is not null) as satisfaction,
        (select count(*)::int from conversations where clinic_id = ${clinic.id} and started_at >= ${month} and satisfaction is not null) as answers,
        (select count(*)::int from appointments where clinic_id = ${clinic.id} and reminder_sent_at >= ${month}) as reminded,
        (select count(*)::int from appointments where clinic_id = ${clinic.id} and reminder_sent_at >= ${month} and confirmed_at is not null) as confirmed,
        (select count(*)::int from appointments where clinic_id = ${clinic.id} and starts_at >= ${month} and starts_at < now() and status = 'atendido') as attended,
        (select count(*)::int from appointments where clinic_id = ${clinic.id} and starts_at >= ${month} and starts_at < now() and status = 'ausente') as absent`,
    // Turnos que sacaron pacientes después de recibir una campaña (30 días), con Sofi, en el panel
    // o por teléfono (también los que se escribieron desde el WhatsApp de la clínica), y su valor de referencia.
    sql<Array<{ appointments: number; revenue: number }>>`
      select count(*)::int as appointments, coalesce(sum(t.price), 0)::float8 as revenue
      from campaign_recipients r
      join campaigns c on c.id = r.campaign_id
      join lateral (
        select a.appointment_type_id from appointments a
        where a.patient_id = r.patient_id and a.created_at >= r.sent_at and a.status <> 'cancelado'
        order by a.created_at
        limit 1
      ) booked on true
      join appointment_types t on t.id = booked.appointment_type_id
      where c.clinic_id = ${clinic.id} and r.sent_at >= ${month}`,
    sql<Array<{ id: string; starts_at: string; status: string; patient: string | null; professional: string; type_name: string }>>`
      select a.id, a.starts_at, a.status, p.full_name as patient, pr.full_name as professional, coalesce(a.title, t.name) as type_name
      from appointments a
      join patients p on p.id = a.patient_id
      join professionals pr on pr.id = a.professional_id
      join appointment_types t on t.id = a.appointment_type_id
      where a.clinic_id = ${clinic.id} and a.starts_at >= ${dayStart} and a.starts_at < ${dayEnd}
        and a.status in ('confirmado', 'pendiente', 'atendido', 'ausente')
      order by a.starts_at`,
    sql<Array<{ id: string; started_at: string; channel: string; title: string | null; summary: string | null; patient: string | null }>>`
      select c.id, c.started_at, c.channel, c.title, c.summary, p.full_name as patient
      from conversations c left join patients p on p.id = c.patient_id
      where c.clinic_id = ${clinic.id}
      order by c.started_at desc
      limit 5`,
    sql<Array<{ id: string; title: string; priority: string }>>`
      select id, title, priority from tasks
      where clinic_id = ${clinic.id} and priority in ('urgente', 'alta') and status <> 'resuelta'
      order by created_at desc
      limit 5`,
  ]);

  const [guarantee, week] = await Promise.all([clinicGuarantee(clinic.id), agentBookings(clinic, 7)]);
  const agent = clinic.agent_name || "Sofi";
  const shortDate = (iso: string) => new Intl.DateTimeFormat("es-AR", { timeZone: tz, day: "numeric", month: "numeric" }).format(new Date(iso));

  const resolutionRate = stats.conversations ? Math.round((stats.resolved / stats.conversations) * 100) : null;
  // Con pocos casos un porcentaje engaña (1 ausente = 100 %): se muestra recién desde 5.
  const MIN_SAMPLE = 5;
  const percent = (part: number, total: number) => (total >= MIN_SAMPLE ? `${Math.round((part / total) * 100)}%` : "—");
  const sample = (total: number, text: string) => (total >= MIN_SAMPLE ? text : `${text} · pocos datos todavía`);
  const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

  // Lo que falta, dicho como lo que hay que hacer (el detalle está en Sistema).
  const checklist = [
    { done: configured.database, todo: "configurar la base de datos" },
    { done: configured.elevenlabs, todo: "cargar la API key de ElevenLabs" },
    { done: Boolean(clinic.elevenlabs_agent_id), todo: "crear el agente en ElevenLabs" },
    {
      done: clinic.whatsapp_provider === "waha" ? configured.waha : Boolean(clinic.whatsapp_phone_number_id),
      todo: clinic.whatsapp_provider === "waha" ? "configurar WhatsApp por WAHA" : "conectar el número de WhatsApp",
    },
    { done: Boolean(process.env.ELEVENLABS_WEBHOOK_SECRET), todo: "configurar el webhook post-conversación" },
  ];
  const listOf = (items: string[]) => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} y ${items.at(-1)}`);
  // La puesta en marcha es técnica y general: solo la ve el administrador.
  const pending = user.role === "admin" ? checklist.filter((c) => !c.done) : [];

  return (
    <>
      <PageHeader
        title={`Hola, ${user.role !== "admin" && user.label ? user.label : clinic.name}`}
        description="Lo de hoy primero; abajo, cómo viene la atención."
      />

      {pending.length > 0 && (
        <Notice tone="warning" className="mb-6 flex flex-wrap items-center justify-between gap-2">
          <span>Para terminar la puesta en marcha general falta {listOf(pending.map((c) => c.todo))}.</span>
          <Link href="/panel/sistema" className="font-semibold text-brand-700 hover:underline">Ir a Sistema →</Link>
        </Notice>
      )}

      {completeness.percent < 100 && <div className="mb-6"><CompletenessCard {...completeness} agent={agent} /></div>}

      {guarantee && (!guarantee.endsAt || Date.parse(guarantee.endsAt) > now.getTime() - 15 * 86400_000) && (
        <Card className="mb-6">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold text-brand-950">Garantía del primer mes</h2>
            {guarantee.interactions >= ACTIVITY_GUARANTEE && <Badge tone="green">Cumplida</Badge>}
          </div>
          {guarantee.operationalAt ? (
            <>
              <p className="mt-1 text-sm text-brand-900/70">
                {clinic.agent_name || "Sofi"} atiende desde el {shortDate(guarantee.operationalAt)}. El primer mes va hasta el {shortDate(guarantee.endsAt!)}.
              </p>
              <p className="mt-3 text-2xl font-semibold text-brand-950">
                {guarantee.interactions} <span className="text-base font-normal text-brand-900/65">de {ACTIVITY_GUARANTEE} interacciones</span>
              </p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-brand-900/10" role="progressbar" aria-valuemin={0} aria-valuemax={ACTIVITY_GUARANTEE} aria-valuenow={Math.min(guarantee.interactions, ACTIVITY_GUARANTEE)} aria-label="Interacciones del primer mes">
                <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.min(100, Math.round((guarantee.interactions / ACTIVITY_GUARANTEE) * 100))}%` }} />
              </div>
            </>
          ) : (
            <p className="mt-1 text-sm text-brand-900/70">
              Todavía no hubo conversaciones con {clinic.agent_name || "Sofi"}{guarantee.clientAt ? ` (cliente desde el ${shortDate(guarantee.clientAt)})` : ""}. El primer mes empieza con la primera.
            </p>
          )}
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-brand-950">Turnos de hoy</h2>
            <Link href="/panel/agenda" className="text-sm text-brand-700 hover:underline">
              Ver agenda
            </Link>
          </div>
          {today.length ? (
            <ul className="divide-y divide-brand-900/5">
              {today.map((a) => (
                <li key={a.id} className="flex items-start gap-3 py-2.5 text-sm">
                  <span className="w-12 shrink-0 font-mono tabular-nums text-brand-900">{formatTime(a.starts_at, tz)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-brand-950">{a.patient ?? "Paciente"}</span>
                    <span className="block text-brand-900/60">{a.type_name} · {a.professional}</span>
                  </span>
                  <StatusBadge value={a.status} />
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No hay turnos para hoy.</Empty>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold text-brand-950">Para el equipo</h2>
              <Badge tone={stats.open_tasks > 0 ? "yellow" : "green"}>{stats.open_tasks === 0 ? "Al día" : stats.open_tasks === 1 ? "1 abierta" : `${stats.open_tasks} abiertas`}</Badge>
            </div>
            {urgentTasks.length ? (
              <ul className="space-y-2 text-sm">
                {urgentTasks.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">{t.title}</span>
                    <StatusBadge value={t.priority} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-brand-900/65">Nada urgente.</p>
            )}
            <Link href="/panel/tareas" className="mt-3 inline-block text-sm text-brand-700 hover:underline">
              Ver tareas
            </Link>
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold text-brand-950">Últimas conversaciones</h2>
              <Link href="/panel/conversaciones" className="text-sm text-brand-700 hover:underline">
                Ver todas
              </Link>
            </div>
            {recentRows.length ? (
              <ul className="space-y-3 text-sm">
                {recentRows.map((c) => (
                  <li key={c.id}>
                    <Link href={`/panel/conversaciones/${c.id}`} className="block rounded-xl p-2 hover:bg-brand-50">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-brand-950">{c.patient ?? "Paciente sin identificar"}</span>
                        <span className="text-xs text-brand-900/65">{formatDateTime(c.started_at, tz)}</span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-brand-900/60">
                        {CHANNEL_LABEL[c.channel]} · {c.title || c.summary || "Sin resumen"}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>
                Todavía no hay conversaciones.{" "}
                <Link href="/panel/probar" className="font-medium text-brand-700 hover:underline">Probá a {clinic.agent_name || "Sofi"}</Link>{" "}
                como si fueras un paciente: la charla aparece acá.
              </Empty>
            )}
          </Card>
        </div>
      </div>
      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wider text-brand-900/65">Últimos 7 días</h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Conversaciones" value={stats.conversations} hint="WhatsApp, teléfono y web" />
        <Stat label={`Resueltas por ${agent}`} value={resolutionRate === null ? "—" : `${resolutionRate}%`} hint="sin que intervenga el equipo" />
        <Stat
          label={`Turnos que dio ${agent}`}
          value={week.total}
          hint={week.total ? `${week.outsideHours} fuera de horario: noches, fines de semana y feriados` : "todavía ninguno esta semana"}
        />
        <Stat
          label="Valor de esos turnos"
          value={week.priced ? money.format(week.value) : "—"}
          hint={week.priced ? `con tus precios · ${week.priced} de ${week.kept} con precio` : week.kept ? "cargá precios en Prestaciones" : "sin turnos todavía"}
        />
      </div>

      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wider text-brand-900/65">Últimos 30 días</h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Satisfacción"
          value={quality.satisfaction === null ? "—" : `${quality.satisfaction}/10`}
          hint={`${quality.answers} ${quality.answers === 1 ? "respuesta" : "respuestas"} a encuestas`}
        />
        <Stat label="Confirmaron asistencia" value={percent(quality.confirmed, quality.reminded)} hint={sample(quality.reminded, `de ${quality.reminded} recordatorios`)} />
        <Stat label="Ausentismo" value={percent(quality.absent, quality.absent + quality.attended)} hint={sample(quality.absent + quality.attended, `${quality.absent} ${quality.absent === 1 ? "ausente" : "ausentes"} de ${quality.absent + quality.attended} ${quality.absent + quality.attended === 1 ? "turno" : "turnos"}`)} />
        <Stat
          label="Recuperado con campañas"
          value={money.format(recovery.revenue)}
          hint={`${recovery.appointments} ${recovery.appointments === 1 ? "turno" : "turnos"} de pacientes que recibieron una campaña`}
        />
      </div>
    </>
  );
}
