import Link from "next/link";
import { db } from "@/lib/supabase";
import { getCatalog, getClinic } from "@/lib/clinic";
import { addDaysKey, formatTime, localDateKey, parseDateKey, zonedTimeToUtc } from "@/lib/time";
import { displayPhone } from "@/lib/phone";
import { setAppointmentStatus } from "../../actions";
import { Card, CHANNEL_LABEL, Empty, PageHeader, StatusBadge, secondaryButtonClass, smallButtonClass } from "@/components/ui";
import { ManualAppointmentForm } from "./manual-form";

type Row = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  source: string;
  coverage: string | null;
  notes: string | null;
  professional_id: string;
  patients: { full_name: string | null; phone: string } | null;
  appointment_types: { name: string } | null;
};

export default async function AgendaPage({ searchParams }: PageProps<"/panel/agenda">) {
  const clinic = await getClinic();
  const tz = clinic.timezone;
  const { fecha } = await searchParams;
  const dayKey = parseDateKey(typeof fecha === "string" ? fecha : null) ?? localDateKey(new Date(), tz);
  const [y, m, d] = dayKey.split("-").map(Number);
  const [ny, nm, nd] = addDaysKey(dayKey, 1).split("-").map(Number);

  const [catalog, result] = await Promise.all([
    getCatalog(clinic.id),
    db()
      .from("appointments")
      .select("id, starts_at, ends_at, status, source, coverage, notes, professional_id, patients(full_name, phone), appointment_types(name)")
      .eq("clinic_id", clinic.id)
      .gte("starts_at", zonedTimeToUtc(y, m, d, 0, 0, tz).toISOString())
      .lt("starts_at", zonedTimeToUtc(ny, nm, nd, 0, 0, tz).toISOString())
      .neq("status", "reprogramado")
      .order("starts_at"),
  ]);
  const rows = (result.data ?? []) as unknown as Row[];
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
            <Link href={`/panel/agenda?fecha=${addDaysKey(dayKey, -1)}`} className={secondaryButtonClass}>
              ← Anterior
            </Link>
            <Link href="/panel/agenda" className={secondaryButtonClass}>
              Hoy
            </Link>
            <Link href={`/panel/agenda?fecha=${addDaysKey(dayKey, 1)}`} className={secondaryButtonClass}>
              Siguiente →
            </Link>
          </>
        }
      />
      <p className="mb-4 text-lg font-semibold capitalize text-brand-900">{label}</p>

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          {catalog.professionals.map((pro) => {
            const list = rows.filter((r) => r.professional_id === pro.id);
            return (
              <Card key={pro.id}>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="font-semibold text-brand-950">
                    {pro.full_name} <span className="font-normal text-brand-900/50">· {pro.specialty}</span>
                  </h2>
                  <span className="text-xs text-brand-900/50">{list.length} turnos</span>
                </div>
                {list.length ? (
                  <ul className="divide-y divide-brand-900/5">
                    {list.map((a) => (
                      <li key={a.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                        <span className="w-24 font-mono text-brand-900">
                          {formatTime(a.starts_at, tz)}–{formatTime(a.ends_at, tz)}
                        </span>
                        <div className="min-w-40 flex-1">
                          <p className="font-medium text-brand-950">{a.patients?.full_name ?? "Paciente"}</p>
                          <p className="text-xs text-brand-900/55">
                            {a.appointment_types?.name} · {a.coverage ?? "sin cobertura"} · {displayPhone(a.patients?.phone)}
                          </p>
                          {a.notes && <p className="mt-0.5 text-xs text-brand-900/55">📝 {a.notes}</p>}
                        </div>
                        <span className="text-xs text-brand-900/50">{CHANNEL_LABEL[a.source] ?? a.source}</span>
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
                  <p className="text-sm text-brand-900/45">Sin turnos este día.</p>
                )}
              </Card>
            );
          })}
          {!catalog.professionals.length && <Empty>Cargá profesionales en Configuración para empezar.</Empty>}
        </div>

        <Card className="h-fit">
          <h2 className="mb-3 font-semibold text-brand-950">Agregar turno a mano</h2>
          <ManualAppointmentForm
            defaultDate={dayKey}
            professionals={catalog.professionals.map((p) => ({ id: p.id, name: p.full_name, specialty: p.specialty }))}
            types={catalog.appointmentTypes.map((t) => ({ id: t.id, name: t.name, specialty: t.specialty }))}
          />
        </Card>
      </div>
    </>
  );
}
