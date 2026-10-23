import { getPanelClinic } from "@/lib/panel-clinic";
import { getScheduleBlocks } from "@/lib/clinic";
import { sql } from "@/lib/db";
import { formatDateTime, localDateKey } from "@/lib/time";
import { deleteScheduleBlock } from "../../../actions";
import { Card, Empty, smallButtonClass } from "@/components/ui";
import type { Professional } from "@/lib/types";
import { ScheduleBlockForm } from "../block-form";
import { ConfigHeader } from "../header";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Feriados y bloqueos · Panel" };

export default async function BlocksPage() {
  const clinic = await getPanelClinic();
  const now = new Date();
  const [professionals, blocks] = await Promise.all([
    sql<Professional[]>`select * from professionals where clinic_id = ${clinic.id} order by full_name`,
    getScheduleBlocks(clinic.id, now, new Date(now.getTime() + 365 * 86400_000)),
  ]);
  const proName = new Map(professionals.map((p) => [p.id, p.full_name]));
  return (
    <>
      <ConfigHeader clinic={clinic} current="/panel/configuracion/bloqueos" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <h2 className="font-semibold text-brand-950">Próximos bloqueos</h2>
          <p className="mt-1 text-sm text-brand-900/60">En estos períodos el agente no ofrece turnos y avisa que no se atiende. Los turnos ya dados no se cancelan solos.</p>
          <ul className="mt-4 space-y-2 text-sm">
            {blocks.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-brand-50/60 px-3 py-2">
                <span className="min-w-0">
                  <span className="font-medium text-brand-950">{b.professional_id ? proName.get(b.professional_id) ?? "Profesional" : "Toda la clínica"}</span>
                  <span className="block text-brand-900/60">{formatDateTime(b.starts_at, clinic.timezone)} → {formatDateTime(b.ends_at, clinic.timezone)}{b.reason ? ` · ${b.reason}` : ""}</span>
                </span>
                <form action={deleteScheduleBlock}><input type="hidden" name="clinic_id" value={clinic.id} />
                  <input type="hidden" name="id" value={b.id} />
                  <button className={smallButtonClass}>Quitar</button>
                </form>
              </li>
            ))}
          </ul>
          {!blocks.length && <div className="mt-4"><Empty>No hay feriados ni bloqueos cargados.</Empty></div>}
        </Card>
        <Card>
          <h2 className="mb-4 font-semibold text-brand-950">Bloquear la agenda</h2>
          <ScheduleBlockForm
            clinicId={clinic.id}
            professionals={professionals.filter((p) => p.active).map((p) => ({ id: p.id, name: p.full_name }))}
            today={localDateKey(now, clinic.timezone)}
          />
        </Card>
      </div>
    </>
  );
}
