import Link from "next/link";
import { sql } from "@/lib/db";
import { getClinic } from "@/lib/clinic";
import { isConfigured } from "@/lib/env";
import { formatDateTime, formatTime, localDateKey, addDaysKey, zonedTimeToUtc } from "@/lib/time";
import { Badge, Card, CHANNEL_LABEL, Empty, PageHeader, Stat, StatusBadge } from "@/components/ui";

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

  const clinic = await getClinic();
  const tz = clinic.timezone;
  const now = new Date();
  const since = new Date(now.getTime() - 7 * 86400_000).toISOString();
  const todayKey = localDateKey(now, tz);
  const [y, m, d] = todayKey.split("-").map(Number);
  const dayStart = zonedTimeToUtc(y, m, d, 0, 0, tz).toISOString();
  const [ny, nm, nd] = addDaysKey(todayKey, 1).split("-").map(Number);
  const dayEnd = zonedTimeToUtc(ny, nm, nd, 0, 0, tz).toISOString();

  const [[stats], today, recentRows, urgentTasks] = await Promise.all([
    sql<Array<{ conversations: number; resolved: number; booked_by_ai: number; open_tasks: number; recovered: number }>>`
      select
        (select count(*)::int from conversations where clinic_id = ${clinic.id} and started_at >= ${since}) as conversations,
        (select count(*)::int from conversations where clinic_id = ${clinic.id} and started_at >= ${since} and outcome = 'resuelto') as resolved,
        (select count(*)::int from appointments where clinic_id = ${clinic.id} and source in ('whatsapp', 'telefono', 'web', 'campana') and created_at >= ${since}) as booked_by_ai,
        (select count(*)::int from tasks where clinic_id = ${clinic.id} and status <> 'resuelta') as open_tasks,
        (select count(*)::int from campaign_recipients r join campaigns c on c.id = r.campaign_id where c.clinic_id = ${clinic.id} and r.status = 'agendo') as recovered`,
    sql<Array<{ id: string; starts_at: string; status: string; patient: string | null; professional: string; type_name: string }>>`
      select a.id, a.starts_at, a.status, p.full_name as patient, pr.full_name as professional, t.name as type_name
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

  const resolutionRate = stats.conversations ? Math.round((stats.resolved / stats.conversations) * 100) : null;

  const checklist = [
    { done: configured.database, label: "Base de datos configurada" },
    { done: configured.elevenlabs, label: "API key de ElevenLabs cargada" },
    { done: Boolean(clinic.elevenlabs_agent_id), label: "Agente creado en ElevenLabs" },
    { done: Boolean(clinic.whatsapp_phone_number_id), label: "Número de WhatsApp conectado" },
    { done: Boolean(process.env.ELEVENLABS_WEBHOOK_SECRET), label: "Webhook post-conversación configurado" },
  ];
  const pending = checklist.filter((c) => !c.done);

  return (
    <>
      <PageHeader title={`Hola, ${clinic.name}`} description="Así viene la atención de los últimos 7 días." />

      {pending.length > 0 && (
        <Card className="mb-6 border-sun-300 bg-sun-100/50">
          <p className="text-sm font-semibold text-brand-950">Terminá la puesta en marcha</p>
          <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
            {checklist.map((c) => (
              <li key={c.label} className={c.done ? "text-brand-700" : "text-brand-950/70"}>
                {c.done ? "✅" : "⬜"} {c.label}
              </li>
            ))}
          </ul>
          <Link href="/panel/configuracion" className="mt-3 inline-block text-sm font-semibold text-brand-700 hover:underline">
            Ir a Configuración →
          </Link>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Conversaciones" value={stats.conversations} hint="WhatsApp, teléfono y web" />
        <Stat label="Resueltas por IA" value={resolutionRate === null ? "—" : `${resolutionRate}%`} hint="sin intervención humana" />
        <Stat label="Turnos dados por IA" value={stats.booked_by_ai} hint="últimos 7 días" />
        <Stat label="Turnos recuperados" value={stats.recovered} hint="por campañas (histórico)" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
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
                <li key={a.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                  <span className="w-12 font-mono text-brand-900">{formatTime(a.starts_at, tz)}</span>
                  <span className="flex-1 font-medium text-brand-950">{a.patient ?? "Paciente"}</span>
                  <span className="text-brand-900/60">
                    {a.type_name} · {a.professional}
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
              <Badge tone={stats.open_tasks > 0 ? "yellow" : "green"}>{stats.open_tasks} abiertas</Badge>
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
              <p className="text-sm text-brand-900/50">Nada urgente. 🎉</p>
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
                        <span className="text-xs text-brand-900/50">{formatDateTime(c.started_at, tz)}</span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-brand-900/60">
                        {CHANNEL_LABEL[c.channel]} · {c.title || c.summary || "Sin resumen"}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>Todavía no hay conversaciones. Probá la demo o escribile al WhatsApp de la clínica.</Empty>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
