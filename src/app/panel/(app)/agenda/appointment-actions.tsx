"use client";

import { useActionState, useState } from "react";
import { useSearchParams } from "next/navigation";
import { submitKeepingValues } from "@/components/keep-form";
import { changeAppointmentStatus, markDayAttended, rescheduleFromPanel } from "../../actions";
import { Field, buttonClass, dangerButtonClass, inputClass, secondaryButtonClass, smallButtonClass } from "@/components/ui";
import { parseClockTime } from "@/lib/time";
import { ForceOption, SlotPicker, dayLabel } from "./slot-picker";

type Option = { id: string; name: string };

export type DetailAppointment = {
  id: string;
  status: string;
  startsAt: string;
  endsAt: string;
  dayKey: string;
  typeId: string;
  professionalId: string;
};

/**
 * Qué se puede hacer con un turno según cuándo es:
 * - por venir: reprogramar o cancelar;
 * - empezado o pasado: atendido o ausente (y, si todavía no terminó, también moverlo);
 * - ya marcado: corregir la marca.
 */
export function AppointmentActions({ clinicId, appt, today, professionals }: { clinicId: string; appt: DetailAppointment; today: string; professionals: Option[] }) {
  const [state, action, pending] = useActionState(changeAppointmentStatus, undefined);
  const [mode, setMode] = useState<"ver" | "cancelar" | "mover">("ver");
  // Hecho el cambio, vuelven los botones (con el turno ya actualizado) y queda el mensaje.
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state?.ok) setMode("ver");
  }
  // La hora del navegador alcanza para elegir qué botones mostrar; el servidor vuelve a validar.
  const [now] = useState(() => Date.now());
  const started = new Date(appt.startsAt).getTime() <= now;
  const over = new Date(appt.endsAt).getTime() <= now;
  const active = appt.status === "confirmado" || appt.status === "pendiente";
  const marked = appt.status === "atendido" || appt.status === "ausente";

  const status = (value: string, label: string, cls = smallButtonClass) => (
    <button name="status" value={value} disabled={pending} className={cls}>{label}</button>
  );

  // Cancelado o reprogramado: no queda nada por hacer.
  if (!active && !marked && !state?.message) return null;

  if (mode === "mover") {
    return <MoveForm clinicId={clinicId} appt={appt} today={today} professionals={professionals} onCancel={() => setMode("ver")} />;
  }

  return (
    <div className="mt-4 space-y-3 border-t border-brand-900/10 pt-4">
      {active && over && <p className="text-xs text-amber-800">Ya pasó y todavía no está marcado. Marcarlo ayuda a las encuestas, el recall y el seguimiento de ausentes.</p>}
      {mode === "cancelar" ? (
        <form action={action} className="space-y-2.5 rounded-xl bg-red-50/60 p-3 ring-1 ring-red-100">
          <input type="hidden" name="clinic_id" value={clinicId} />
          <input type="hidden" name="id" value={appt.id} />
          <p className="text-sm font-medium text-red-900">¿Cancelar este turno?</p>
          <p className="text-xs leading-relaxed text-red-900/80">
            Se borra de Google Calendar y el horario se le ofrece a la lista de espera. Al paciente no le llega un aviso automático: avisale vos.
          </p>
          <Field label="Motivo (opcional)">
            <input name="reason" autoComplete="off" placeholder="Ej.: el profesional no viene" className={inputClass} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <button name="status" value="cancelado" disabled={pending} className={dangerButtonClass}>{pending ? "Cancelando…" : "Sí, cancelar"}</button>
            <button type="button" onClick={() => setMode("ver")} className={secondaryButtonClass}>No</button>
          </div>
        </form>
      ) : (
        <form action={action} className="flex flex-wrap gap-1.5">
          <input type="hidden" name="clinic_id" value={clinicId} />
          <input type="hidden" name="id" value={appt.id} />
          {active && started && (
            <>
              {status("atendido", "Atendido")}
              {status("ausente", "Ausente")}
            </>
          )}
          {marked && (
            <>
              {appt.status === "atendido" ? status("ausente", "Era ausente") : status("atendido", "Era atendido")}
              {status("confirmado", "Quitar la marca")}
            </>
          )}
          {active && !over && (
            <>
              <button type="button" onClick={() => setMode("mover")} className={smallButtonClass}>Reprogramar</button>
              <button type="button" onClick={() => setMode("cancelar")} className={`${smallButtonClass} !text-red-700 !ring-red-200 hover:!bg-red-50`}>Cancelar turno</button>
            </>
          )}
        </form>
      )}
      {state?.message && (
        <p role="status" className={`rounded-xl px-3 py-2 text-sm ${state.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>{state.message}</p>
      )}
    </div>
  );
}

/** Mover el turno: mismo paciente y prestación; se elige día, horario y, si hace falta, otro profesional. */
function MoveForm({ clinicId, appt, today, professionals, onCancel }: { clinicId: string; appt: DetailAppointment; today: string; professionals: Option[]; onCancel: () => void }) {
  const [state, action, pending] = useActionState(rescheduleFromPanel, undefined);
  const params = useSearchParams();
  const [proId, setProId] = useState(appt.professionalId);
  const [date, setDate] = useState(appt.dayKey < today ? today : appt.dayKey);
  const [time, setTime] = useState("");
  const [custom, setCustom] = useState(false);
  const slotKey = `${proId}|${date}|${time}`;
  const [forceKey, setForceKey] = useState<string | null>(null);
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    setForceKey(state?.forzable ? slotKey : null);
  }

  const at = parseClockTime(time);
  return (
    <form onSubmit={submitKeepingValues(action)} className="mt-4 space-y-3 border-t border-brand-900/10 pt-4">
      <input type="hidden" name="clinic_id" value={clinicId} />
      <input type="hidden" name="appointment_id" value={appt.id} />
      {/* Al moverlo, el servidor abre la ficha del turno nuevo con la misma vista y filtro. */}
      <input type="hidden" name="back" value={params.toString()} />
      <p className="text-sm font-semibold text-brand-950">Reprogramar</p>
      {professionals.length > 1 && (
        <Field label="Profesional">
          <select name="professional_id" value={proId} onChange={(e) => { setProId(e.target.value); if (!custom) setTime(""); }} className={inputClass}>
            {professionals.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </Field>
      )}
      {professionals.length <= 1 && <input type="hidden" name="professional_id" value={proId} />}
      <SlotPicker
        clinicId={clinicId}
        typeId={appt.typeId}
        proId={proId}
        today={today}
        date={date}
        onDate={setDate}
        time={time}
        onTime={setTime}
        custom={custom}
        onCustom={setCustom}
        ignoreId={appt.id}
      />
      {state?.message && <p role="status" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{state.message}</p>}
      <ForceOption key={slotKey} show={forceKey === slotKey} />
      <p className="text-xs text-brand-900/60">El evento se mueve en Google Calendar. Al paciente no le llega un aviso automático: avisale vos.</p>
      <div className="flex flex-wrap gap-2">
        <button disabled={!at || pending} className={buttonClass}>{pending ? "Moviendo…" : at ? `Mover al ${dayLabel(date)} · ${at}` : "Elegí un horario"}</button>
        <button type="button" onClick={onCancel} className={secondaryButtonClass}>Volver</button>
      </div>
    </form>
  );
}

/** Aviso arriba de la grilla: turnos que ya pasaron sin marcar, con un botón para marcarlos todos como atendidos. */
export function MarkAttended({ clinicId, ids }: { clinicId: string; ids: string[] }) {
  const [state, action, pending] = useActionState(markDayAttended, undefined);
  const [sure, setSure] = useState(false);
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-950 ring-1 ring-amber-200">
      <p className="min-w-0 flex-1">
        {state?.ok ? state.message : (
          <>
            <strong className="font-semibold">{ids.length === 1 ? "1 turno ya pasó" : `${ids.length} turnos ya pasaron`} sin marcar.</strong>{" "}
            Tocá cada uno para marcar ausentes; los atendidos se marcan todos juntos. Con la marca funcionan las encuestas, el recall y el seguimiento de ausentes.
          </>
        )}
      </p>
      {!state?.ok && (
        <form action={action} className="flex shrink-0 gap-2">
          <input type="hidden" name="clinic_id" value={clinicId} />
          {ids.map((id) => <input key={id} type="hidden" name="id" value={id} />)}
          {sure ? (
            <>
              <button disabled={pending} className={`${buttonClass} !bg-amber-600 hover:!bg-amber-700`}>{pending ? "Marcando…" : `Sí, ${ids.length === 1 ? "marcarlo" : `marcar los ${ids.length}`}`}</button>
              <button type="button" onClick={() => setSure(false)} className={secondaryButtonClass}>No</button>
            </>
          ) : (
            <button type="button" onClick={() => setSure(true)} className={secondaryButtonClass}>Marcar {ids.length === 1 ? "como atendido" : "todos como atendidos"}</button>
          )}
        </form>
      )}
    </div>
  );
}
