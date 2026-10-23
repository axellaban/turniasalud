import { getPanelClinic } from "@/lib/panel-clinic";
import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { isUuid } from "@/lib/clinic";
import { formatDateTime } from "@/lib/time";
import { displayPhone } from "@/lib/phone";
import { Badge, Card, CHANNEL_LABEL, PageHeader, StatusBadge } from "@/components/ui";
import type { Conversation } from "@/lib/types";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Conversación · Panel" };

export default async function ConversationDetail({ params }: PageProps<"/panel/conversaciones/[id]">) {
  const { id } = await params;
  const clinic = await getPanelClinic();
  type Detail = Conversation & { patients: { id: string; full_name: string | null; phone: string; coverage: string | null } | null };
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
            {!(c.transcript ?? []).length && <p className="text-brand-900/50">Sin transcripción.</p>}
          </div>
        </Card>
        <div className="space-y-4">
          <Card>
            <h2 className="font-semibold text-brand-950">Resumen</h2>
            <p className="mt-2 text-sm leading-relaxed text-brand-900/75">{c.summary || "Sin resumen."}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {c.intent && <Badge>{c.intent.replace(/_/g, " ")}</Badge>}
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
              <p className="mt-2 text-sm text-brand-900/50">No identificado.</p>
            )}
          </Card>
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
