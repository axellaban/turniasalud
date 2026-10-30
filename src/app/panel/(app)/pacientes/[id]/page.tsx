import { getPanelClinic, getPanelUser } from "@/lib/panel-clinic";
import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { isUuid } from "@/lib/clinic";
import { formatDate, formatDateTime } from "@/lib/time";
import { displayPhone } from "@/lib/phone";
import { Card, CHANNEL_LABEL, Notice, PageHeader, StatusBadge, buttonClass, smallButtonClass } from "@/components/ui";
import { mergePatientDuplicates, setContactOptOut } from "../../../actions";
import { duplicatesOf } from "@/lib/patients";
import { patientDocuments } from "@/lib/documents-panel";
import { NextControl } from "./next-control";
import { DeletePatientButton } from "../delete-patients";
import type { Patient, PatientVisit } from "@/lib/types";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Paciente · Panel" };

const DOCUMENT_LABEL: Record<string, string> = {
  credencial: "Credencial",
  orden: "Orden o derivación",
  receta: "Receta",
  estudio: "Estudio o resultado",
  otro: "Otra foto",
  ilegible: "Foto que no se leía bien",
};

export default async function PatientDetail({ params, searchParams }: PageProps<"/panel/pacientes/[id]">) {
  const { id } = await params;
  // Las pruebas renderizan la ficha sin searchParams.
  const { unificadas } = (await searchParams) ?? {};
  const mergedCount = typeof unificadas === "string" ? Number(unificadas) : 0;
  const clinic = await getPanelClinic();
  const canDelete = (await getPanelUser()).role === "admin";
  const [p] = isUuid(id) ? await sql<Patient[]>`select * from patients where id = ${id} and clinic_id = ${clinic.id}` : [];
  if (!p) notFound();
  const [appointments, conversations, tasks, visits, duplicates, documents] = await Promise.all([
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
    // Visitas anteriores a Turnia, de la importación.
    sql<Array<PatientVisit & { type_name: string | null }>>`
      select v.*, t.name as type_name from patient_visits v left join appointment_types t on t.id = v.appointment_type_id
      where v.patient_id = ${p.id} order by v.visited_at desc limit 30`,
    duplicatesOf(p),
    patientDocuments(clinic.id, p.id),
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
      {mergedCount > 0 && (
        <Notice tone="success" className="mb-4">
          {mergedCount === 1 ? "Se unificó 1 ficha repetida" : `Se unificaron ${mergedCount} fichas repetidas`} en esta: sus turnos,
          conversaciones y visitas ahora están acá.
        </Notice>
      )}
      {duplicates.length > 0 && (
        <Card className="mb-6 border-sun-300 bg-sun-100/40">
          <h2 className="text-sm font-semibold text-brand-950">
            {duplicates.length === 1 ? "Hay otra ficha" : `Hay ${duplicates.length} fichas más`} con el DNI {p.dni}
          </h2>
          <p className="mt-1 text-xs text-brand-900/70">
            Al unificarlas, sus turnos, conversaciones, pedidos y visitas pasan a esta ficha, se completan los datos que le falten y las
            repetidas se borran. Sus números quedan asociados a esta ficha.
          </p>
          <ul className="mt-3 divide-y divide-brand-900/5 text-sm">
            {duplicates.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                <Link href={`/panel/pacientes/${d.id}`} className="font-medium text-brand-800 hover:underline">
                  {d.full_name ?? "Sin nombre"}
                </Link>
                <span className="text-xs text-brand-900/65">{displayPhone(d.phone)}</span>
                <span className="text-xs text-brand-900/65">
                  {d.last_contact_at ? `Último contacto: ${formatDate(d.last_contact_at, tz)}` : "Sin contacto"}
                </span>
              </li>
            ))}
          </ul>
          <form action={mergePatientDuplicates} className="mt-3">
            <input type="hidden" name="id" value={p.id} />
            <input type="hidden" name="clinic_id" value={clinic.id} />
            <button className={buttonClass}>Unificar en esta ficha</button>
          </form>
        </Card>
      )}
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
          <Card>
            <h2 className="text-sm font-semibold text-brand-950">Próximo control</h2>
            <p className="mb-3 mt-1 text-xs text-brand-900/65">Cuando llega la fecha, aparece en Campañas → «Controles vencidos» para escribirle.</p>
            <NextControl clinicId={clinic.id} patientId={p.id} date={p.next_control_at} reason={p.next_control_reason} />
          </Card>
          {documents.length > 0 && (
            <Card>
              <h2 className="text-sm font-semibold text-brand-950">Fotos y documentos que mandó</h2>
              <p className="mb-2 mt-1 text-xs text-brand-900/65">Sofi los leyó en la conversación. Revisalos antes de usar los datos.</p>
              <ul className="divide-y divide-brand-900/5 text-sm">
                {documents.map((d) => (
                  <li key={d.id} className="py-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium text-brand-950">{DOCUMENT_LABEL[d.kind] ?? "Archivo"}</span>
                      <span className="text-xs text-brand-900/60">{formatDate(d.created_at, tz)}</span>
                    </div>
                    {d.summary && <p className="mt-0.5 text-xs text-brand-900/70">{d.summary}</p>}
                    <a href={`/panel/pacientes/${p.id}/documentos/${d.id}`} target="_blank" rel="noreferrer" className="mt-1 inline-flex text-xs font-medium text-brand-700 hover:underline">
                      {d.mimetype === "application/pdf" ? "Abrir el PDF" : "Ver la foto"} →
                    </a>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card className="bg-brand-50/60">
            <h2 className="text-sm font-semibold text-brand-950">🧠 Memoria del paciente</h2>
            <p className="mt-2 text-sm text-brand-900/75">{p.memory_summary || "Todavía no hay nada para recordar."}</p>
          </Card>
          {canDelete && (
            <Card>
              <h2 className="text-sm font-semibold text-brand-950">Borrar ficha</h2>
              <p className="mb-3 mt-1 text-xs text-brand-900/65">
                Para fichas de prueba o cargadas por error. Se borran también sus turnos, conversaciones y pedidos.
              </p>
              <DeletePatientButton id={p.id} clinicId={clinic.id} name={p.full_name ?? "Paciente sin nombre"} />
            </Card>
          )}
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
          {visits.length > 0 && (
            <Card>
              <h2 className="font-semibold text-brand-950">Visitas anteriores</h2>
              <p className="mb-2 text-xs text-brand-900/60">Traídas de la importación: cuentan para los controles y los inactivos.</p>
              <ul className="divide-y divide-brand-900/5 text-sm">
                {visits.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center gap-3 py-2">
                    <span className="w-40 text-brand-900/70">{formatDate(`${v.visited_at}T12:00:00Z`, "UTC")}</span>
                    <span className="flex-1">
                      {v.type_name ?? (v.service || "Visita")}
                      {v.professional ? ` · ${v.professional}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
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
