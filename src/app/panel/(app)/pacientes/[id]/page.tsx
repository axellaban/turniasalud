import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/supabase";
import { getClinic } from "@/lib/clinic";
import { formatDate, formatDateTime } from "@/lib/time";
import { displayPhone } from "@/lib/phone";
import { Card, CHANNEL_LABEL, PageHeader, StatusBadge } from "@/components/ui";
import type { Patient } from "@/lib/types";

export default async function PatientDetail({ params }: PageProps<"/panel/pacientes/[id]">) {
  const { id } = await params;
  const clinic = await getClinic();
  const { data } = await db().from("patients").select("*").eq("id", id).eq("clinic_id", clinic.id).maybeSingle();
  if (!data) notFound();
  const p = data as Patient;
  const [appointments, conversations, tasks] = await Promise.all([
    db()
      .from("appointments")
      .select("id, starts_at, status, source, professionals(full_name), appointment_types(name)")
      .eq("patient_id", p.id)
      .order("starts_at", { ascending: false })
      .limit(30),
    db().from("conversations").select("id, started_at, channel, title, summary, outcome").eq("patient_id", p.id).order("started_at", { ascending: false }).limit(20),
    db().from("tasks").select("id, title, status, created_at").eq("patient_id", p.id).order("created_at", { ascending: false }).limit(20),
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
                  <dt className="text-brand-900/50">{label}</dt>
                  <dd className="text-right text-brand-950">{value || "—"}</dd>
                </div>
              ))}
            </dl>
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
              {((appointments.data ?? []) as unknown as Array<{
                id: string;
                starts_at: string;
                status: string;
                source: string;
                professionals: { full_name: string } | null;
                appointment_types: { name: string } | null;
              }>).map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="w-40 text-brand-900/70">{formatDateTime(a.starts_at, tz)}</span>
                  <span className="flex-1">
                    {a.appointment_types?.name} · {a.professionals?.full_name}
                  </span>
                  <span className="text-xs text-brand-900/50">{CHANNEL_LABEL[a.source]}</span>
                  <StatusBadge value={a.status} />
                </li>
              ))}
              {!(appointments.data ?? []).length && <li className="py-2 text-brand-900/50">Sin turnos.</li>}
            </ul>
          </Card>
          <Card>
            <h2 className="mb-3 font-semibold text-brand-950">Conversaciones</h2>
            <ul className="space-y-2 text-sm">
              {((conversations.data ?? []) as Array<{ id: string; started_at: string; channel: string; title: string | null; summary: string | null; outcome: string | null }>).map((c) => (
                <li key={c.id}>
                  <Link href={`/panel/conversaciones/${c.id}`} className="flex items-center gap-3 rounded-xl p-2 hover:bg-brand-50">
                    <span className="w-36 shrink-0 text-xs text-brand-900/55">{formatDateTime(c.started_at, tz)}</span>
                    <span className="flex-1 truncate">
                      {CHANNEL_LABEL[c.channel]} · {c.title || c.summary || "Sin resumen"}
                    </span>
                    <StatusBadge value={c.outcome} />
                  </Link>
                </li>
              ))}
              {!(conversations.data ?? []).length && <li className="text-brand-900/50">Sin conversaciones.</li>}
            </ul>
          </Card>
          {(tasks.data ?? []).length > 0 && (
            <Card>
              <h2 className="mb-3 font-semibold text-brand-950">Tareas</h2>
              <ul className="space-y-2 text-sm">
                {(tasks.data as Array<{ id: string; title: string; status: string }>).map((t) => (
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
