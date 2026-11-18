import { NOTICE_KINDS, NOTICE_LABEL, listNoticePhones, noticeLine, recentNotices, type NoticePhone, type NoticeRow } from "@/lib/clinic-notices";
import { listStaffPhones, type StaffPhone } from "@/lib/staff";
import { SUMMARY_HOUR, summaryDaysLabel } from "@/lib/daily-summary";
import { displayPhone } from "@/lib/phone";
import { formatDateTime } from "@/lib/time";
import type { Clinic } from "@/lib/types";
import { Badge, Card, Field, Notice, inputClass, smallButtonClass } from "@/components/ui";
import { addNoticePhone, addTeamMember, removeTeamMember, setAutoPause, setNoticeEvents } from "../../notice-actions";
import { AUTO_PAUSE_HOURS } from "@/lib/waha-own";
import { addStaffPhone, sendSummaryNowAction, toggleStaffSummary } from "../../protocol-actions";
import { ActionForm } from "./action-form";
import { NoticeTestButton } from "./notice-test";
import { StaffAgentSetup } from "./clinic-agent";

const STATUS: Record<NoticeRow["status"], { label: string; tone: "green" | "yellow" | "red" | "gray" }> = {
  enviado: { label: "Enviado", tone: "green" },
  pendiente: { label: "En cola", tone: "yellow" },
  enviando: { label: "Enviando", tone: "yellow" },
  error: { label: "Reintentando", tone: "red" },
  vencido: { label: "No salió", tone: "gray" },
};
const KIND: Record<NoticeRow["kind"], string> = {
  nuevo: "Turno nuevo", movido: "Turno movido", cancelado: "Turno cancelado", prueba: "Prueba",
  smile: "Revisar en Smile Connect", smile_paciente: "Seguimiento al paciente", smile_confirmado: "Confirmación al paciente",
  smile_cancelado: "Cancelación al paciente",
};

export type NoticeCardData = { phones: NoticePhone[]; staff: StaffPhone[]; recent: NoticeRow[]; line: ReturnType<typeof noticeLine> };

/** Lo que muestra la tarjeta (se carga en la página, junto con lo demás). */
export async function loadNoticeCard(clinic: Clinic): Promise<NoticeCardData> {
  const [phones, staff, recent] = await Promise.all([listNoticePhones(clinic.id), listStaffPhones(clinic.id), recentNotices(clinic.id, 6)]);
  return { phones, staff, recent, line: noticeLine(clinic) };
}

type Member = { phone: string; name: string; notice: NoticePhone | null; staff: StaffPhone | null };

/** Cada celular una sola vez, con lo que recibe de cada lista (avisos, acceso total y resumen). */
export function teamMembers(phones: NoticePhone[], staff: StaffPhone[]): Member[] {
  const byPhone = new Map<string, Member>();
  for (const s of staff) byPhone.set(s.phone, { phone: s.phone, name: s.name, notice: null, staff: s });
  for (const n of phones) {
    const m = byPhone.get(n.phone);
    if (m) m.notice = n;
    else byPhone.set(n.phone, { phone: n.phone, name: n.name, notice: n, staff: null });
  }
  return [...byPhone.values()];
}

const hidden = (clinicId: string, fields: Record<string, string>) => (
  <>
    <input type="hidden" name="clinic_id" value={clinicId} />
    {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
  </>
);

/**
 * Configuración → Equipo por WhatsApp. Antes eran tres listas (avisos, acceso total y resumen) con las
 * mismas personas cargadas dos veces; ahora cada celular aparece una vez con lo que recibe.
 */
export function NoticeCard({ clinic, admin, data: { phones, staff, recent, line } }: { clinic: Clinic; admin: boolean; data: NoticeCardData }) {
  const agent = clinic.agent_name || "Sofi";
  const members = teamMembers(phones, staff);
  const withAccess = members.filter((m) => m.staff).length;
  return (
    <Card id="avisos-whatsapp" className="scroll-mt-20">
      <span id="whatsapp-equipo" className="block scroll-mt-20" />
      <h2 className="font-semibold text-brand-950">Equipo por WhatsApp</h2>
      <p className="mt-1 text-sm text-brand-900/60">Los celulares del consultorio y lo que recibe cada uno:</p>
      <ul className="mt-2 space-y-1 text-xs text-brand-900/70">
        <li><span className="font-medium text-brand-950">Avisos:</span> el detalle de cada turno que {agent} da, mueve o cancela a pedido de un paciente. Lo que hace el equipo desde el panel no se avisa.</li>
        <li><span className="font-medium text-brand-950">Resumen de las {SUMMARY_HOUR}:</span> de {summaryDaysLabel(clinic.id)}, lo que {agent} dio, movió y canceló, con los datos para pasarlo a la agenda del consultorio.</li>
        <li><span className="font-medium text-brand-950">Acceso total:</span> al escribirle a {agent}, ve la agenda y los pacientes, da, mueve y cancela turnos, bloquea la agenda y responde pedidos. Solo por WhatsApp: el número de una llamada se puede falsear.</li>
      </ul>
      {line.problem
        ? <Notice tone="warning" className="mt-3">{line.problem}</Notice>
        : <p className="mt-2 text-xs text-brand-900/65">Salen por {line.phone ? `la línea de WhatsApp del consultorio (${displayPhone(line.phone)})` : "la línea de WhatsApp de Turnia"}.</p>}

      {members.length > 0 && <ul className="mt-3 divide-y divide-brand-900/5 text-sm">
        {members.map((m) => {
          const canRemove = admin || !m.staff;
          return <li key={m.phone} className="space-y-2 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0"><span className="font-medium text-brand-950">{m.name}</span> <span className="text-brand-900/65">· {displayPhone(m.phone)}</span></span>
              {canRemove && <form action={removeTeamMember}>
                {hidden(clinic.id, { phone: m.phone })}
                <button className={smallButtonClass} aria-label={`Quitar a ${m.name} de la lista`}>Quitar</button>
              </form>}
            </div>

            {m.notice ? (
              <form action={setNoticeEvents} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {hidden(clinic.id, { id: m.notice.id })}
                <span className="text-xs font-medium text-brand-950">Avisos:</span>
                {NOTICE_KINDS.map((k) => <label key={k} className="inline-flex items-center gap-1.5 text-xs text-brand-900/80">
                  <input type="checkbox" name={`event_${k}`} defaultChecked={m.notice!.events.includes(k)} /> {NOTICE_LABEL[k]}
                </label>)}
                <button className={smallButtonClass}>Guardar</button>
              </form>
            ) : (
              <ActionForm action={addNoticePhone} submit="Mandarle avisos de turnos" secondary className="flex flex-wrap items-center gap-2">
                {hidden(clinic.id, { name: m.name, phone: m.phone, ...Object.fromEntries(NOTICE_KINDS.map((k) => [`event_${k}`, "on"])) })}
                <span className="text-xs text-brand-900/65">Avisos: no recibe.</span>
              </ActionForm>
            )}

            <div className="flex flex-wrap items-center gap-2 text-xs">
              {m.staff ? (
                <>
                  <Badge tone="green">Acceso total</Badge>
                  <span className="text-brand-900/70">{m.staff.daily_summary ? `Recibe el resumen de las ${SUMMARY_HOUR}` : "No recibe el resumen"}</span>
                  <form action={toggleStaffSummary}>
                    {hidden(clinic.id, { id: m.staff.id, on: m.staff.daily_summary ? "0" : "1" })}
                    <button className={smallButtonClass} aria-label={`${m.staff.daily_summary ? "Dejar de mandarle" : "Mandarle"} el resumen a ${m.name}`}>
                      {m.staff.daily_summary ? "Sacar el resumen" : "Mandarle el resumen"}
                    </button>
                  </form>
                </>
              ) : admin ? (
                <ActionForm action={addStaffPhone} submit="Dar acceso total" secondary className="flex flex-wrap items-center gap-2">
                  {hidden(clinic.id, { name: m.name, phone: m.phone })}
                  <span className="text-brand-900/65">Sin acceso total.</span>
                </ActionForm>
              ) : (
                <span className="text-brand-900/65">Sin acceso total ni resumen: los habilita Turnia.</span>
              )}
            </div>
            {m.notice && <NoticeTestButton clinicId={clinic.id} phoneId={m.notice.id} name={m.name} />}
            {!canRemove && <p className="text-xs text-brand-900/60">Para quitarle el acceso total, pedíselo a Turnia.</p>}
          </li>;
        })}
      </ul>}

      <ActionForm action={addTeamMember} submit="Agregar al equipo" resetOnSuccess secondary className="mt-4 grid gap-3 border-t border-brand-900/5 pt-4">
        <input type="hidden" name="clinic_id" value={clinic.id} />
        <Field label="De quién es"><input name="name" required maxLength={80} placeholder="Recepción" className={inputClass} /></Field>
        <Field label="Celular" hint="Con código de área. Es el de WhatsApp. Revisalo bien: lo que recibe lleva datos de pacientes.">
          <input name="phone" required inputMode="tel" placeholder="223 555-0100" className={inputClass} />
        </Field>
        <fieldset className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-brand-900/80">
          <legend className="mb-1 text-sm font-medium text-brand-950">Qué recibe</legend>
          {NOTICE_KINDS.map((k) => <label key={k} className="inline-flex items-center gap-1.5"><input type="checkbox" name={`event_${k}`} defaultChecked /> Aviso: {NOTICE_LABEL[k].toLowerCase()}</label>)}
          {admin && <>
            <label className="inline-flex items-center gap-1.5"><input type="checkbox" name="access" /> Acceso total</label>
            <label className="inline-flex items-center gap-1.5"><input type="checkbox" name="summary" /> Resumen de las {SUMMARY_HOUR} (con acceso total)</label>
          </>}
        </fieldset>
      </ActionForm>

      {/* Pausa automática: si el equipo contesta desde el celular, Sofi no responde en ese chat por un rato. */}
      <div className="mt-4 border-t border-brand-900/5 pt-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium text-brand-950">
            Pausa automática {clinic.auto_pause_on_staff_reply ? <Badge tone="green">Prendida</Badge> : <Badge>Apagada</Badge>}
          </p>
          <form action={setAutoPause}>
            {hidden(clinic.id, { on: clinic.auto_pause_on_staff_reply ? "0" : "1" })}
            <button className={smallButtonClass}>{clinic.auto_pause_on_staff_reply ? "Apagarla" : "Prenderla"}</button>
          </form>
        </div>
        <p className="mt-1 text-xs text-brand-900/65">
          Si alguien del equipo le contesta a un paciente desde el WhatsApp del consultorio, {agent} deja de contestarle por {AUTO_PAUSE_HOURS} horas
          para que no respondan los dos. Se reactiva desde la charla o desde Conversaciones. Los mensajes automáticos de WhatsApp Business
          (bienvenida o ausencia) no la activan. Necesita que la conexión de WhatsApp avise también los mensajes propios: lo configura Turnia.
        </p>
      </div>

      {admin && withAccess > 0 && <div className="mt-4 rounded-lg bg-brand-50/60 p-3 text-sm text-brand-900/70">
        <p>¿Querés ver el resumen ahora? Sale a quienes lo reciben, con lo de hoy desde el último envío.</p>
        <ActionForm action={sendSummaryNowAction} submit="Mandar el resumen ahora" pendingLabel="Mandando…" secondary className="mt-2"><input type="hidden" name="clinic_id" value={clinic.id} /></ActionForm>
        <p className="mt-3 text-xs text-brand-900/65">
          Si {agent} no reconoce a alguien del equipo (le contesta como a un paciente), actualizala una vez. Después, cada celular nuevo vale desde su próximo mensaje.
        </p>
        <div className="mt-2"><StaffAgentSetup key={clinic.id} clinicId={clinic.id} agentName={agent} disabled={!process.env.ELEVENLABS_API_KEY} /></div>
      </div>}

      {recent.length > 0 && <div className="mt-4 border-t border-brand-900/5 pt-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-brand-900/60">Últimos avisos</h3>
        <ul className="mt-2 space-y-1.5 text-xs">
          {recent.map((n) => <li key={n.id} className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS[n.status].tone}>{STATUS[n.status].label}</Badge>
            <span className="text-brand-950">{KIND[n.kind]}</span>
            <span className="text-brand-900/65">· {displayPhone(n.phone)} · {formatDateTime(n.created_at, clinic.timezone)}</span>
            {n.error && n.status !== "enviado" && <span className="w-full text-red-700">{n.error}</span>}
          </li>)}
        </ul>
      </div>}
    </Card>
  );
}
