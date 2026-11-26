import { getPanelClinic } from "@/lib/panel-clinic";
import { getScheduleBlocks } from "@/lib/clinic";
import { sql } from "@/lib/db";
import { localDateKey } from "@/lib/time";
import { groupBlocks } from "@/lib/block-groups";
import { getSmileApiConnection, smileIsSource } from "@/lib/smile-connect-link";
import { deleteScheduleBlock, loadNationalHolidays } from "../../../actions";
import { ActionForm } from "../action-form";
import { Card, Empty, smallButtonClass } from "@/components/ui";
import type { Professional } from "@/lib/types";
import { ScheduleBlockForm } from "../block-form";
import { ConfigHeader, loadSmileSource } from "../header";
import { LockIcon, SmileLock } from "../smile-lock";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Feriados y bloqueos · Panel" };

export default async function BlocksPage() {
  const clinic = await getPanelClinic();
  const now = new Date();
  const [professionals, blocks, smile] = await Promise.all([
    sql<Professional[]>`select * from professionals where clinic_id = ${clinic.id} order by full_name`,
    getScheduleBlocks(clinic.id, now, new Date(now.getTime() + 365 * 86400_000)),
    getSmileApiConnection(clinic.id).catch(() => null),
  ]);
  // Con Smile Connect, la agenda real (bloqueos y feriados) está allá y Sofi solo ofrece lo libre allá.
  const fromSmileConnect = smileIsSource(smile);
  const proName = new Map(professionals.map((p) => [p.id, p.full_name]));
  const groups = groupBlocks(blocks, proName, clinic.timezone);
  return (
    <>
      <ConfigHeader smileMode={await loadSmileSource(clinic.id)} clinic={clinic} current="/panel/configuracion/bloqueos" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <h2 className="font-semibold text-brand-950">Próximos bloqueos</h2>
          <p className="mt-1 text-sm text-brand-900/60">En estos períodos {clinic.agent_name || "Sofi"} no ofrece turnos y avisa que no se atiende. Los turnos ya dados no se cancelan solos.</p>
          <ul className="mt-4 space-y-2 text-sm">
            {groups.map((g) => (
              <li key={g.ids[0]} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-brand-50/60 px-3 py-2">
                <span className="min-w-0">
                  <span className="font-medium text-brand-950">{g.when}</span>
                  <span className="block text-brand-900/60">{g.who}{g.reason ? ` · ${g.reason}` : ""}</span>
                </span>
                {g.fromSmile
                  ? <span title="Viene de Smile Connect: se quita allá y llega sola." className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-900 ring-1 ring-violet-200"><LockIcon className="h-3 w-3" />De Smile Connect</span>
                  : <form action={deleteScheduleBlock}><input type="hidden" name="clinic_id" value={clinic.id} />
                    {g.ids.map((id) => <input key={id} type="hidden" name="id" value={id} />)}
                    <button className={smallButtonClass}>{g.ids.length > 1 ? `Quitar (${g.ids.length})` : "Quitar"}</button>
                  </form>}
              </li>
            ))}
          </ul>
          {!blocks.length && <div className="mt-4"><Empty>No hay feriados ni bloqueos cargados.</Empty></div>}
        </Card>
        <Card className="self-start lg:sticky lg:top-4">
          <h2 className="font-semibold text-brand-950">{fromSmileConnect ? `Frenar a ${clinic.agent_name || "Sofi"}` : "Bloquear la agenda"}</h2>
          {fromSmileConnect
            ? <p className="mb-4 mt-1 text-sm text-brand-900/60">Para cerrar la agenda del consultorio (vacaciones, un congreso), bloqueala en Smile Connect: {clinic.agent_name || "Sofi"} ya no ofrece esos días. Esto es para lo que es solo de {clinic.agent_name || "Sofi"}: días en que no tiene que dar turnos aunque en Smile Connect haya lugar.</p>
            : <div className="mb-4" />}
          <ScheduleBlockForm
            agent={clinic.agent_name || "Sofi"}
            clinicId={clinic.id}
            professionals={professionals.filter((p) => p.active).map((p) => ({ id: p.id, name: p.full_name }))}
            today={localDateKey(now, clinic.timezone)}
          />
          {fromSmileConnect ? <SmileLock title="Feriados nacionales" className="mt-6">No hace falta cargarlos: la disponibilidad de Smile Connect ya los descuenta y {clinic.agent_name || "Sofi"} solo ofrece lo libre allá.</SmileLock> : <div className="mt-6 border-t border-brand-900/10 pt-5">
            <h3 className="font-semibold text-brand-950">Feriados nacionales</h3>
            <p className="mt-1 text-sm text-brand-900/60">Carga los del próximo año como días sin atención de toda la clínica, con su nombre. Los que ya están no se repiten; si un año atienden un feriado, quitalo de la lista.</p>
            <ActionForm action={loadNationalHolidays} submit="Cargar feriados" pendingLabel="Cargando…" secondary className="mt-3 space-y-3">
              <input type="hidden" name="clinic_id" value={clinic.id} />
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="bridges" className="mt-1" />
                <span>También los puentes turísticos<span className="block text-xs text-brand-900/60">Son no laborables: muchos consultorios atienden igual.</span></span>
              </label>
            </ActionForm>
          </div>}
        </Card>
      </div>
    </>
  );
}
