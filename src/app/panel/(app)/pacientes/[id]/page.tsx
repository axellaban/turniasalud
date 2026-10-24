import { getPanelClinic } from "@/lib/panel-clinic";
import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { isUuid } from "@/lib/clinic";
import { formatDate, formatDateTime } from "@/lib/time";
import { displayPhone } from "@/lib/phone";
import { Card, CHANNEL_LABEL, PageHeader, StatusBadge, smallButtonClass } from "@/components/ui";
import { setContactOptOut } from "../../../actions";
import type { Patient } from "@/lib/types";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Paciente · Panel" };

export default async function PatientDetail({ params }: PageProps<"/panel/pacientes/[id]">) {
  const { id } = await params;
  const clinic = await getPanelClinic();
  const [p] = isUuid(id) ? await sql<Patient[]>`select * from patients where id = ${id} and clinic_id = ${clinic.id}` : [];
  if (!p) notFound();
  const [appointments, conversations, tasks] = await Promise.all([
    sql<Array<{ id: string; starts_at: string; status: string; source: string; professional: string; type_name: string }>>`
      select a.id, a.starts_at, a.status, a.source, pr.full_name as professional, t.name as type_name
      from appointments a
      join professionals pr on pr.id = a.professional_id
      join appointment_types t on t.id = a.appointment_type_id
      where a.patient_id = ${p.id}
      order by a.starts_at desc
      limit 30`,
    sql<Array<{ id: string; started_at: string; channel: string; title: string | null; summary: string | null; outcome: string | null }>>`
      select id, started_at, channel, title, summary, outcome from conversations
      where patient_id = ${p.id} order by started_at desc limit 20`,
    sql<Array<{ id: string; title: string; status: string; created_at: string }>>`
      select id, title, status, created_at from tasks where patient_id = ${p.id} order by created_at desc limit 20`,
  ]);
  const tz = clinic.timezone;

  const facts = [
    ["Celular", displayPhone(p.phone)],
    ["DNI", p.dni],
    ["Nacimiento", p.birth_date ? formatDate(`${p.birth_date}T12:00:00Z`, "UTC") : null],
    ["Email", p.email],
    ["Cobertura", [p.coverage, p.coverage_plan].filter(Boolean).join(" ")],
    ["N° afiliado", p.member_number],
    ["Preferencias", p.preferences],
  ];

  return (
    <>
      <Link href="/panel/pacientes" className="text-sm text-brand-700 hover:underline">
        ← Pacientes
      </Link>
      <PageHeader title={p.full_name ?? "Paciente sin nombre"} />
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="space-y-4">
          <Card>
            <dl className="space-y-2 text-sm">
              {facts.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3">
                  <dt className="text-brand-900/65">{label}</dt>
                  <dd className="text-right text-brand-950">{value || "—"}</dd>
                </div>
              ))}
            </dl>
            <form action={setContactOptOut} className="mt-4 flex items-center justify-between gap-2 border-t border-brand-900/5 pt-3 text-sm">
              <input type="hidden" name="id" value={p.id} />
              <input type="hidden" name="opt_out" value={String(!p.contact_opt_out)} />
              <span className={p.contact_opt_out ? "text-red-700" : "text-brand-900/60"}>
                {p.contact_opt_out ? "🔕 Pidió no recibir campañas" : "Recibe campañas por WhatsApp"}
              </span>
              <button className={smallButtonClass}>{p.contact_opt_out ? "Volver a habilitar" : "Dar de baja"}</button>
            </form>
          </Card>
          <Card className="bg-brand-50/60">
            <h2 className="text-sm font-semibold text-brand-950">🧠 Memoria del paciente</h2>
            <p className="mt-2 text-sm text-brand-900/75">{p.memory_summary || "Todavía no hay nada para recordar."}</p>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <h2 className="mb-3 font-semibold text-brand-950">Turnos</h2>
            <ul className="divide-y divide-brand-900/5 text-sm">
              {appointments.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="w-40 text-brand-900/70">{formatDateTime(a.starts_at, tz)}</span>
                  <span className="flex-1">
                    {a.type_name} · {a.professional}
                  </span>
                  <span className="text-xs text-brand-900/65">{CHANNEL_LABEL[a.source]}</span>
                  <StatusBadge value={a.status} />
                </li>
              ))}
              {!appointments.length && <li className="py-2 text-brand-900/65">Sin turnos.</li>}
            </ul>
          </Card>
          <Card>
            <h2 className="mb-3 font-semibold text-brand-950">Conversaciones</h2>
            <ul className="space-y-2 text-sm">
              {conversations.map((c) => (
                <li key={c.id}>
                  <Link href={`/panel/conversaciones/${c.id}`} className="flex items-center gap-3 rounded-xl p-2 hover:bg-brand-50">
                    <span className="w-36 shrink-0 text-xs text-brand-900/65">{formatDateTime(c.started_at, tz)}</span>
                    <span className="flex-1 truncate">
                      {CHANNEL_LABEL[c.channel]} · {c.title || c.summary || "Sin resumen"}
                    </span>
                    <StatusBadge value={c.outcome} />
                  </Link>
                </li>
              ))}
              {!conversations.length && <li className="text-brand-900/65">Sin conversaciones.</li>}
            </ul>
          </Card>
          {tasks.length > 0 && (
            <Card>
              <h2 className="mb-3 font-semibold text-brand-950">Tareas</h2>
              <ul className="space-y-2 text-sm">
                {tasks.map((t) => (
                  <li key={t.id} className="flex items-center justify-between">
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
