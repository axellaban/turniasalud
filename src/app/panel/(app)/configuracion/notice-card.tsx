import { NOTICE_KINDS, NOTICE_LABEL, listNoticePhones, noticeLine, recentNotices, type NoticeRow } from "@/lib/clinic-notices";
import { displayPhone } from "@/lib/phone";
import { formatDateTime } from "@/lib/time";
import type { Clinic } from "@/lib/types";
import { Badge, Card, Field, Notice, inputClass, smallButtonClass } from "@/components/ui";
import { addNoticePhone, removeNoticePhone, setNoticeEvents } from "../../notice-actions";
import { ActionForm } from "./action-form";
import { NoticeTestButton } from "./notice-test";

const STATUS: Record<NoticeRow["status"], { label: string; tone: "green" | "yellow" | "red" | "gray" }> = {
  enviado: { label: "Enviado", tone: "green" },
  pendiente: { label: "En cola", tone: "yellow" },
  error: { label: "Reintentando", tone: "red" },
  vencido: { label: "No salió", tone: "gray" },
};
const KIND: Record<NoticeRow["kind"], string> = { nuevo: "Turno nuevo", movido: "Turno movido", cancelado: "Turno cancelado", prueba: "Prueba" };

/** Configuración → a qué celulares les llega el aviso de cada turno que da, mueve o cancela Sofi. */
export async function NoticeCard({ clinic }: { clinic: Clinic }) {
  const agent = clinic.agent_name || "Sofi";
  const [phones, recent] = await Promise.all([listNoticePhones(clinic.id), recentNotices(clinic.id, 6)]);
  const line = noticeLine(clinic);
  return (
    <Card id="avisos-whatsapp" className="scroll-mt-20">
      <h2 className="font-semibold text-brand-950">Avisos por WhatsApp</h2>
      <p className="mt-1 text-sm text-brand-900/60">
        Cada vez que {agent} da, mueve o cancela un turno a pedido de un paciente, a estos celulares les llega el detalle: día y hora, profesional,
        prestación, el motivo que contó el paciente y sus datos. Lo que hace el equipo desde el panel no se avisa.
      </p>
      {line.problem
        ? <Notice tone="warning" className="mt-3">{line.problem}</Notice>
        : <p className="mt-2 text-xs text-brand-900/65">Salen por {line.phone ? `la línea de WhatsApp del consultorio (${displayPhone(line.phone)})` : "la línea de WhatsApp de Turnia"}.</p>}

      {phones.length > 0 && <ul className="mt-3 divide-y divide-brand-900/5 text-sm">
        {phones.map((p) => <li key={p.id} className="space-y-2 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0"><span className="font-medium text-brand-950">{p.name}</span> <span className="text-brand-900/65">· {displayPhone(p.phone)}</span></span>
            <form action={removeNoticePhone}>
              <input type="hidden" name="clinic_id" value={clinic.id} /><input type="hidden" name="id" value={p.id} />
              <button className={smallButtonClass} aria-label={`Dejar de avisarle a ${p.name}`}>Quitar</button>
            </form>
          </div>
          <form action={setNoticeEvents} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <input type="hidden" name="clinic_id" value={clinic.id} /><input type="hidden" name="id" value={p.id} />
            {NOTICE_KINDS.map((k) => <label key={k} className="inline-flex items-center gap-1.5 text-xs text-brand-900/80">
              <input type="checkbox" name={`event_${k}`} defaultChecked={p.events.includes(k)} /> {NOTICE_LABEL[k]}
            </label>)}
            <button className={smallButtonClass}>Guardar</button>
          </form>
          <NoticeTestButton clinicId={clinic.id} phoneId={p.id} name={p.name} />
        </li>)}
      </ul>}

      <ActionForm action={addNoticePhone} submit="Agregar celular" resetOnSuccess secondary className="mt-4 grid gap-3">
        <input type="hidden" name="clinic_id" value={clinic.id} />
        <Field label="De quién es"><input name="name" required maxLength={80} placeholder="Recepción" className={inputClass} /></Field>
        <Field label="Celular" hint="Con código de área. Es el de WhatsApp. Revisalo bien: el aviso lleva datos del paciente.">
          <input name="phone" required inputMode="tel" placeholder="223 555-0100" className={inputClass} />
        </Field>
        <fieldset className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-brand-900/80">
          <legend className="mb-1 text-sm font-medium text-brand-950">Qué avisos recibe</legend>
          {NOTICE_KINDS.map((k) => <label key={k} className="inline-flex items-center gap-1.5"><input type="checkbox" name={`event_${k}`} defaultChecked /> {NOTICE_LABEL[k]}</label>)}
        </fieldset>
      </ActionForm>

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
