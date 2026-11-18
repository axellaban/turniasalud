import { getPanelClinic } from "@/lib/panel-clinic";
import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { isUuid } from "@/lib/clinic";
import { formatDateTime, localDateKey } from "@/lib/time";
import { PAUSE_HOURS } from "@/lib/chat-guard";
import { pauseChatNumber, reactivateChatNumber } from "../../../actions";
import { displayPhone } from "@/lib/phone";
import { Badge, Card, CHANNEL_LABEL, inputClass, intentLabel, PageHeader, StatusBadge, smallButtonClass } from "@/components/ui";
import type { Conversation } from "@/lib/types";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Conversación · Panel" };

export default async function ConversationDetail({ params }: PageProps<"/panel/conversaciones/[id]">) {
  const { id } = await params;
  const clinic = await getPanelClinic();
  type Detail = Conversation & { patients: { id: string; full_name: string | null; phone: string | null; coverage: string | null } | null };
  const [c] = isUuid(id)
    ? await sql<Detail[]>`
        select c.*,
          case when p.id is null then null
               else json_build_object('id', p.id, 'full_name', p.full_name, 'phone', p.phone, 'coverage', p.coverage) end as patients
        from conversations c left join patients p on p.id = c.patient_id
        where c.id = ${id} and c.clinic_id = ${clinic.id}`
    : [];
  if (!c) notFound();
  const tasks = c.elevenlabs_conversation_id
    ? await sql<Array<{ id: string; title: string; status: string; priority: string }>>`
        select id, title, status, priority from tasks
        where clinic_id = ${clinic.id} and conversation_id = ${c.elevenlabs_conversation_id}
        order by created_at`
    : [];
  const sentiment = (c.analysis as { sentimiento?: string } | null)?.sentimiento;
  // El celular del chat (WhatsApp), para pausar a Sofi y que conteste el equipo.
  const [chat] = c.channel === "whatsapp"
    ? await sql<{ phone: string }[]>`
        select phone from channel_conversations where clinic_id = ${clinic.id} and elevenlabs_conversation_id = ${c.elevenlabs_conversation_id ?? ""}
        union all select ${c.patients?.phone ?? ""} where ${Boolean(c.patients?.phone)}
        limit 1`
    : [];
  const chatPhone = chat?.phone && /^\d{8,15}$/.test(chat.phone) ? chat.phone : null;
  const [mute] = chatPhone
    ? await sql<{ until: string; reason: string }[]>`select until, reason from chat_mutes where clinic_id = ${clinic.id} and phone = ${chatPhone} and until > now()`
    : [];
  // Los turnos que tiene por delante, para ir directo a la agenda.
  const upcoming = c.patients
    ? await sql<Array<{ id: string; starts_at: string; type_name: string; professional: string; status: string }>>`
        select a.id, a.starts_at, coalesce(a.title, t.name) as type_name, pr.full_name as professional, a.status
        from appointments a join appointment_types t on t.id = a.appointment_type_id join professionals pr on pr.id = a.professional_id
        where a.clinic_id = ${clinic.id} and a.patient_id = ${c.patients.id} and a.starts_at >= now() and a.status in ('confirmado', 'pendiente')
        order by a.starts_at limit 5`
    : [];
  const agent = clinic.agent_name || "Sofi";

  return (
    <>
      <Link href="/panel/conversaciones" className="text-sm text-brand-700 hover:underline">
        ← Conversaciones
      </Link>
      <PageHeader title={c.title || "Conversación"} description={`${CHANNEL_LABEL[c.channel]} · ${formatDateTime(c.started_at, clinic.timezone)}`} />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <h2 className="mb-4 font-semibold text-brand-950">Transcripción</h2>
          <div className="space-y-2 rounded-xl bg-[#efeae2] p-4 text-sm">
            {(c.transcript ?? [])
              .filter((t) => t.message)
              .map((t, i) => (
                <p
                  key={i}
                  className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 shadow-sm ${
                    t.role === "user" ? "ml-auto rounded-tr-none bg-[#d9fdd3]" : "rounded-tl-none bg-white"
                  }`}
                >
                  {t.message}
                </p>
              ))}
            {!(c.transcript ?? []).length && <p className="text-brand-900/65">Sin transcripción.</p>}
          </div>
        </Card>
        <div className="space-y-4">
          <Card>
            <h2 className="font-semibold text-brand-950">Resumen</h2>
            <p className="mt-2 text-sm leading-relaxed text-brand-900/75">{c.summary || "Sin resumen."}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {c.intent && <Badge>{intentLabel(c.intent)}</Badge>}
              <StatusBadge value={c.outcome} />
              {sentiment && <Badge tone={sentiment === "negativo" ? "red" : sentiment === "positivo" ? "green" : "gray"}>{sentiment}</Badge>}
              {c.duration_secs !== null && <Badge>{Math.round((c.duration_secs ?? 0) / 60)} min</Badge>}
              {c.satisfaction !== null && (
                <Badge tone={c.satisfaction >= 9 ? "green" : c.satisfaction <= 6 ? "red" : "gray"}>encuesta: {c.satisfaction}/10</Badge>
              )}
            </div>
          </Card>
          <Card>
            <h2 className="font-semibold text-brand-950">Paciente</h2>
            {c.patients ? (
              <Link href={`/panel/pacientes/${c.patients.id}`} className="mt-2 block text-sm hover:underline">
                <p className="font-medium text-brand-950">{c.patients.full_name ?? "Sin nombre"}</p>
                <p className="text-brand-900/60">
                  {displayPhone(c.patients.phone)} · {c.patients.coverage ?? "sin cobertura"}
                </p>
              </Link>
            ) : (
              <p className="mt-2 text-sm text-brand-900/65">No identificado.</p>
            )}
          </Card>
          {upcoming.length > 0 && (
            <Card>
              <h2 className="font-semibold text-brand-950">Próximos turnos</h2>
              <ul className="mt-2 space-y-2 text-sm">
                {upcoming.map((a) => (
                  <li key={a.id}>
                    <Link href={`/panel/agenda?fecha=${localDateKey(new Date(a.starts_at), clinic.timezone)}&turno=${a.id}`} className="block hover:underline">
                      <span className="font-medium text-brand-950">{formatDateTime(a.starts_at, clinic.timezone)}</span>
                      <span className="block text-brand-900/60">{a.type_name} · {a.professional}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {chatPhone && (
            <Card>
              <h2 className="font-semibold text-brand-950">{agent} en este chat</h2>
              {mute ? (
                <>
                  <p className="mt-1 text-sm text-brand-900/70">
                    {mute.reason === "equipo" ? `En pausa: lo atiende el equipo hasta el ${formatDateTime(mute.until, clinic.timezone)}.` : `En pausa hasta el ${formatDateTime(mute.until, clinic.timezone)}.`}
                  </p>
                  <form action={reactivateChatNumber} className="mt-3">
                    <input type="hidden" name="clinic_id" value={clinic.id} />
                    <input type="hidden" name="phone" value={chatPhone} />
                    <button className={smallButtonClass}>Que {agent} vuelva a contestar</button>
                  </form>
                </>
              ) : (
                <>
                  <p className="mt-1 text-sm text-brand-900/70">
                    Si le vas a contestar vos desde el WhatsApp del consultorio, pausala para que no respondan los dos. Los avisos y confirmaciones de turnos siguen saliendo.
                  </p>
                  <form action={pauseChatNumber} className="mt-3 flex flex-wrap items-center gap-2">
                    <input type="hidden" name="clinic_id" value={clinic.id} />
                    <input type="hidden" name="phone" value={chatPhone} />
                    <select name="hours" defaultValue="4" className={`${inputClass} w-auto py-1.5`} aria-label="Por cuánto tiempo">
                      {PAUSE_HOURS.map((h) => <option key={h} value={h}>{h === 1 ? "1 hora" : h < 24 ? `${h} horas` : h === 24 ? "1 día" : `${h / 24} días`}</option>)}
                    </select>
                    <button className={smallButtonClass}>Pausar a {agent}</button>
                  </form>
                </>
              )}
            </Card>
          )}
          {tasks.length > 0 && (
            <Card>
              <h2 className="font-semibold text-brand-950">Tareas creadas</h2>
              <ul className="mt-2 space-y-2 text-sm">
                {tasks.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2">
                    <span>{t.title}</span>
                    <StatusBadge value={t.status} />
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
