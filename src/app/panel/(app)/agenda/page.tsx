import { getPanelClinic } from "@/lib/panel-clinic";
import Link from "next/link";
import { sql } from "@/lib/db";
import { getCatalog, getScheduleBlocks } from "@/lib/clinic";
import { addDaysKey, formatTime, localDateKey, parseDateKey, zonedTimeToUtc } from "@/lib/time";
import { displayPhone } from "@/lib/phone";
import { setAppointmentStatus } from "../../actions";
import { Card, CHANNEL_LABEL, Empty, PageHeader, StatusBadge, secondaryButtonClass, smallButtonClass } from "@/components/ui";
import { ManualAppointmentForm } from "./manual-form";
import { ManualPanel } from "./manual-panel";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Agenda · Panel" };

type Row = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  source: string;
  coverage: string | null;
  notes: string | null;
  confirmed_at: string | null;
  reminder_sent_at: string | null;
  professional_id: string;
  patient: string | null;
  phone: string;
  type_name: string;
};

export default async function AgendaPage({ searchParams }: PageProps<"/panel/agenda">) {
  const clinic = await getPanelClinic();
  const tz = clinic.timezone;
  const { fecha } = await searchParams;
  const dayKey = parseDateKey(typeof fecha === "string" ? fecha : null) ?? localDateKey(new Date(), tz);
  const [y, m, d] = dayKey.split("-").map(Number);
  const [ny, nm, nd] = addDaysKey(dayKey, 1).split("-").map(Number);

  const dayStart = zonedTimeToUtc(y, m, d, 0, 0, tz);
  const dayEnd = zonedTimeToUtc(ny, nm, nd, 0, 0, tz);
  // Semana (de lunes a domingo) que contiene el día elegido, con la cantidad de turnos de cada día.
  const weekday = new Date(`${dayKey}T12:00:00Z`).getUTCDay();
  const weekStartKey = addDaysKey(dayKey, -((weekday + 6) % 7));
  const week = Array.from({ length: 7 }, (_, i) => addDaysKey(weekStartKey, i));
  const [wy, wm, wd] = weekStartKey.split("-").map(Number);
  const [ey, em, ed] = addDaysKey(weekStartKey, 7).split("-").map(Number);
  const todayKey = localDateKey(new Date(), tz);
  const [catalog, rows, blocks, weekCounts] = await Promise.all([
    getCatalog(clinic.id),
    sql<Row[]>`
      select a.id, a.starts_at, a.ends_at, a.status, a.source, a.coverage, a.notes, a.confirmed_at, a.reminder_sent_at, a.professional_id,
             p.full_name as patient, p.phone, t.name as type_name
      from appointments a
      join patients p on p.id = a.patient_id
      join appointment_types t on t.id = a.appointment_type_id
      where a.clinic_id = ${clinic.id}
        and a.starts_at >= ${dayStart} and a.starts_at < ${dayEnd}
        and a.status <> 'reprogramado'
      order by a.starts_at`,
    getScheduleBlocks(clinic.id, dayStart, dayEnd),
    sql<Array<{ day: string; count: number }>>`
      select to_char(a.starts_at at time zone ${tz}, 'YYYY-MM-DD') as day, count(*)::int as count
      from appointments a
      where a.clinic_id = ${clinic.id} and a.status in ('confirmado', 'pendiente', 'atendido', 'ausente')
        and a.starts_at >= ${zonedTimeToUtc(wy, wm, wd, 0, 0, tz)} and a.starts_at < ${zonedTimeToUtc(ey, em, ed, 0, 0, tz)}
      group by 1`,
  ]);
  const countFor = new Map(weekCounts.map((w) => [w.day, w.count]));
  const dayName = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "short" });
  const dayNumber = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", day: "numeric" });
  const blockFor = (professionalId: string) => blocks.find((b) => !b.professional_id || b.professional_id === professionalId);
  const label = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(
    new Date(`${dayKey}T12:00:00Z`),
  );

  return (
    <>
      <PageHeader
        title="Agenda"
        description="Los turnos que da el agente aparecen acá al instante."
        actions={
          <>
            <Link href={`/panel/agenda?fecha=${addDaysKey(dayKey, -7)}`} className={secondaryButtonClass} aria-label="Semana anterior">‹ Semana</Link>
            {dayKey !== todayKey && <Link href="/panel/agenda" className={secondaryButtonClass}>Hoy</Link>}
            <Link href={`/panel/agenda?fecha=${addDaysKey(dayKey, 7)}`} className={secondaryButtonClass} aria-label="Semana siguiente">Semana ›</Link>
          </>
        }
      />
      <nav aria-label="Días de la semana" className="mb-5 grid grid-cols-7 gap-1.5">
        {week.map((key) => {
          const date = new Date(`${key}T12:00:00Z`);
          const selected = key === dayKey;
          const count = countFor.get(key) ?? 0;
          return (
            <Link key={key} href={`/panel/agenda?fecha=${key}`} aria-current={selected ? "date" : undefined}
              className={`flex flex-col items-center rounded-2xl px-1 py-2 text-center transition ${selected ? "bg-brand-600 text-white shadow-sm" : "bg-white ring-1 ring-brand-900/10 hover:ring-brand-300"}`}>
              <span className={`text-[11px] font-medium uppercase ${selected ? "text-white/90" : "text-brand-900/65"}`}>{dayName.format(date).replace(".", "")}</span>
              <span className={`text-lg font-semibold leading-tight ${!selected && key === todayKey ? "text-brand-600" : ""}`}>{dayNumber.format(date)}</span>
              <span className={`text-[11px] ${selected ? "text-white/85" : count ? "text-brand-700" : "text-brand-900/35"}`}>{count ? `${count} turno${count === 1 ? "" : "s"}` : "—"}</span>
            </Link>
          );
        })}
      </nav>
      <p className="mb-4 text-lg font-semibold text-brand-900 first-letter:uppercase">{label}{dayKey === todayKey ? " · hoy" : ""}</p>

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          {catalog.professionals.filter((pro) => rows.some((r) => r.professional_id === pro.id) || blockFor(pro.id)).map((pro) => {
            const list = rows.filter((r) => r.professional_id === pro.id);
            const block = blockFor(pro.id);
            return (
              <Card key={pro.id}>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="font-semibold text-brand-950">
                    {pro.full_name} <span className="font-normal text-brand-900/65">· {pro.specialty}</span>
                  </h2>
                  <span className="text-xs text-brand-900/65">{list.length} turnos</span>
                </div>
                {block && (
                  <p className="mb-3 rounded-lg bg-sun-100 px-3 py-2 text-xs text-brand-950">
                    Agenda bloqueada{" "}
                    {new Date(block.starts_at) <= dayStart && new Date(block.ends_at) >= dayEnd
                      ? "todo el día"
                      : `${formatTime(block.starts_at, tz)}–${formatTime(block.ends_at, tz)}`}
                    {block.reason ? ` · ${block.reason}` : ""}. El agente no ofrece turnos en ese horario.
                  </p>
                )}
                {list.length ? (
                  <ul className="divide-y divide-brand-900/5">
                    {list.map((a) => (
                      <li key={a.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                        <span className="w-24 font-mono text-brand-900">
                          {formatTime(a.starts_at, tz)}–{formatTime(a.ends_at, tz)}
                        </span>
                        <div className="min-w-40 flex-1">
                          <p className="font-medium text-brand-950">{a.patient ?? "Paciente"}</p>
                          <p className="text-xs text-brand-900/65">
                            {a.type_name} · {a.coverage ?? "sin cobertura"} · {displayPhone(a.phone)}
                          </p>
                          {a.notes && <p className="mt-0.5 text-xs text-brand-900/65">Nota: {a.notes}</p>}
                        </div>
                        <span className="text-xs text-brand-900/65">{CHANNEL_LABEL[a.source] ?? a.source}</span>
                        {a.confirmed_at ? (
                          <span className="text-xs font-medium text-brand-700" title="El paciente confirmó que viene">Confirmó asistencia</span>
                        ) : a.reminder_sent_at ? (
                          <span className="text-xs text-brand-900/65">Recordatorio enviado</span>
                        ) : null}
                        <StatusBadge value={a.status} />
                        {(a.status === "confirmado" || a.status === "pendiente") && (
                          <form action={setAppointmentStatus} className="flex gap-1">
                            <input type="hidden" name="id" value={a.id} />
                            <button name="status" value="atendido" className={smallButtonClass}>
                              Atendido
                            </button>
                            <button name="status" value="ausente" className={smallButtonClass}>
                              Ausente
                            </button>
                            <button name="status" value="cancelado" className={smallButtonClass}>
                              Cancelar
                            </button>
                          </form>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-brand-900/65">Sin turnos este día.</p>
                )}
              </Card>
            );
          })}
          {(() => {
            const free = catalog.professionals.filter((pro) => !rows.some((r) => r.professional_id === pro.id) && !blockFor(pro.id));
            if (!free.length) return null;
            return free.length === catalog.professionals.length
              ? <Empty>No hay turnos este día.</Empty>
              : <p className="text-sm text-brand-900/65">Sin turnos: {free.map((p) => p.full_name).join(", ")}.</p>;
          })()}
          {!catalog.professionals.length && <Empty>Cargá profesionales en Configuración → Equipo y horarios para empezar.</Empty>}
        </div>

        <div className="h-fit xl:sticky xl:top-20">
          <ManualPanel>
          <ManualAppointmentForm
            clinicId={clinic.id}
            defaultDate={dayKey}
            today={todayKey}
            professionals={catalog.professionals.map((p) => ({ id: p.id, name: p.full_name, specialty: p.specialty }))}
            types={catalog.appointmentTypes.map((t) => ({ id: t.id, name: t.name, specialty: t.specialty }))}
          />
          </ManualPanel>
        </div>
      </div>
    </>
  );
}
