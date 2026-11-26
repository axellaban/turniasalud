import { ErrorText } from "./error-text";
import { NOTICE_KINDS, NOTICE_LABEL, listNoticePhones, noticeLine, recentNotices, type NoticePhone, type NoticeRow } from "@/lib/clinic-notices";
import { listStaffPhones, type StaffPhone } from "@/lib/staff";
import { SUMMARY_HOUR, summaryDaysLabel } from "@/lib/daily-summary";
import { displayPhone } from "@/lib/phone";
import { formatDateTime } from "@/lib/time";
import type { Clinic } from "@/lib/types";
import { Badge, Card, Field, Notice, inputClass, smallButtonClass } from "@/components/ui";
import { addNoticePhone, addTeamMember, removeTeamMember, setAutoPause, setNoticeEvents, setSummaryDays } from "../../notice-actions";
import { AUTO_PAUSE_HOURS } from "@/lib/waha-own";
import { addStaffPhone, sendSummaryNowAction, toggleStaffSummary } from "../../protocol-actions";
import { ActionForm } from "./action-form";
import { NoticeTestButton } from "./notice-test";
import { StaffAgentSetup } from "./clinic-agent";
import { lastClinicWhatsappHealth, type StoredWahaHealth } from "@/lib/waha-health";

const STATUS: Record<NoticeRow["status"], { label: string; tone: "green" | "yellow" | "red" | "gray" }> = {
  enviado: { label: "Enviado", tone: "green" },
  pendiente: { label: "En cola", tone: "yellow" },
  enviando: { label: "Enviando", tone: "yellow" },
  error: { label: "Reintentando", tone: "red" },
  vencido: { label: "No salió", tone: "gray" },
  en_chat: { label: "Dicho en el chat", tone: "green" },
};
const KIND: Record<NoticeRow["kind"], string> = {
  nuevo: "Turno nuevo", movido: "Turno movido", cancelado: "Turno cancelado", prueba: "Prueba",
  smile: "Revisar en Smile Connect", smile_paciente: "Seguimiento al paciente", smile_confirmado: "Confirmación al paciente",
  smile_cancelado: "Cancelación al paciente",
};

export type NoticeCardData = { phones: NoticePhone[]; staff: StaffPhone[]; recent: NoticeRow[]; line: ReturnType<typeof noticeLine>; health?: StoredWahaHealth | null };

/** Lo que muestra la tarjeta (se carga en la página, junto con lo demás). */
export async function loadNoticeCard(clinic: Clinic): Promise<NoticeCardData> {
  const [phones, staff, recent, health] = await Promise.all([listNoticePhones(clinic.id), listStaffPhones(clinic.id), recentNotices(clinic.id, 6), lastClinicWhatsappHealth(clinic.id)]);
  return { phones, staff, recent, health, line: noticeLine(clinic) };
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
export function NoticeCard({ clinic, admin, data: { phones, staff, recent, line, health } }: { clinic: Clinic; admin: boolean; data: NoticeCardData }) {
  const agent = clinic.agent_name || "Sofi";
  const members = teamMembers(phones, staff);
  const withAccess = members.filter((m) => m.staff).length;
  return (
    <Card id="avisos-whatsapp" className="scroll-mt-20">
      <span id="whatsapp-equipo" className="block scroll-mt-20" />
      <h2 className="font-semibold text-brand-950">Equipo por WhatsApp</h2>
      {health && <Notice tone={health.status === "WORKING" ? "success" : "warning"} className="mt-3">
        Último control de la línea: {health.status === "WORKING" ? "Conectada" : "Necesita revisión (" + health.status + ")"} · {formatDateTime(health.checked_at, clinic.timezone)}.
        {health.status !== "WORKING" && " Revisá la vinculación y las confirmaciones pendientes. El control se repite cada diez minutos."}
      </Notice>}
      <p className="mt-1 text-sm text-brand-900/60">Los celulares del consultorio y lo que recibe cada uno:</p>
      <ul className="mt-2 space-y-1 text-xs text-brand-900/70">
        <li><span className="font-medium text-brand-950">Avisos:</span> el detalle de cada turno que {agent} da, mueve o cancela a pedido de un paciente. Lo que hace el equipo desde el panel no se avisa.</li>
        <li><span className="font-medium text-brand-950">Resumen de las {SUMMARY_HOUR}:</span> de {summaryDaysLabel(clinic)}, lo que {agent} dio, movió y canceló, con los datos para pasarlo a la agenda del consultorio.</li>
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

            {/* Una fila por cosa que recibe: a la izquierda qué es, después cómo está y al final la acción. */}
            <dl className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] items-center gap-x-3 gap-y-2 text-xs">
              <dt className="font-medium text-brand-950">Avisos de turnos</dt>
              <dd>
                {m.notice ? (
                  <form action={setNoticeEvents} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {hidden(clinic.id, { id: m.notice.id })}
                    {NOTICE_KINDS.map((k) => <label key={k} className="inline-flex items-center gap-1.5 text-brand-900/80">
                      <input type="checkbox" name={`event_${k}`} defaultChecked={m.notice!.events.includes(k)} /> {NOTICE_LABEL[k]}
                    </label>)}
                    <button className={smallButtonClass}>Guardar</button>
                  </form>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>No recibe</Badge>
                    <ActionForm action={addNoticePhone} submit="Mandarle avisos" secondary className="flex flex-wrap items-center gap-2">
                      {hidden(clinic.id, { name: m.name, phone: m.phone, ...Object.fromEntries(NOTICE_KINDS.map((k) => [`event_${k}`, "on"])) })}
                    </ActionForm>
                  </div>
                )}
              </dd>

              <dt className="font-medium text-brand-950">Acceso total</dt>
              <dd className="flex flex-wrap items-center gap-2">
                {m.staff ? <Badge tone="green">Sí</Badge> : <Badge>No</Badge>}
                {!m.staff && (admin ? (
                  <ActionForm action={addStaffPhone} submit="Dar acceso total" secondary className="flex flex-wrap items-center gap-2">
                    {hidden(clinic.id, { name: m.name, phone: m.phone })}
                  </ActionForm>
                ) : <span className="text-brand-900/65">Lo habilita Turnia.</span>)}
                {m.staff && !canRemove && <span className="text-brand-900/60">Para quitárselo, pedíselo a Turnia.</span>}
              </dd>

              {m.staff && <>
                <dt className="font-medium text-brand-950">Resumen de las {SUMMARY_HOUR}</dt>
                <dd className="flex flex-wrap items-center gap-2">
                  <Badge tone={m.staff.daily_summary ? "green" : "gray"}>{m.staff.daily_summary ? "Lo recibe" : "No lo recibe"}</Badge>
                  <form action={toggleStaffSummary}>
                    {hidden(clinic.id, { id: m.staff.id, on: m.staff.daily_summary ? "0" : "1" })}
                    <button className={smallButtonClass} aria-label={`${m.staff.daily_summary ? "Dejar de mandarle" : "Mandarle"} el resumen a ${m.name}`}>
                      {m.staff.daily_summary ? "Sacárselo" : "Mandárselo"}
                    </button>
                  </form>
                </dd>
              </>}
            </dl>
            {m.notice && <NoticeTestButton clinicId={clinic.id} phoneId={m.notice.id} name={m.name} />}
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

      {/* Días del resumen de las 10: hasta qué día de la semana sale (siempre desde el lunes). */}
      {staff.length > 0 && <form action={setSummaryDays} className="mt-4 flex flex-wrap items-center gap-2 border-t border-brand-900/5 pt-4 text-sm">
        <input type="hidden" name="clinic_id" value={clinic.id} />
        <label htmlFor="summary-days" className="font-medium text-brand-950">Días del resumen</label>
        <select id="summary-days" name="summary_last_weekday" defaultValue={String(clinic.summary_last_weekday ?? 5)} className={`${inputClass} w-auto py-1.5`}>
          {[[4, "Lunes a jueves"], [5, "Lunes a viernes"], [6, "Lunes a sábado"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button className={smallButtonClass}>Guardar</button>
      </form>}

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
            {n.error && n.status !== "enviado" && <ErrorText raw={n.error} className="w-full text-red-700" />}
          </li>)}
        </ul>
      </div>}
    </Card>
  );
}
