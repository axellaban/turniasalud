import Link from "next/link";
import { Badge, smallButtonClass } from "@/components/ui";
import { formatDate } from "@/lib/time";
import type { Outreach } from "@/lib/sales/outreach";
import {
  CHANNEL_LABEL,
  CLOSED,
  MAX_TOUCHES,
  PERMISSION_WAIT_HOURS,
  STATUS_LABEL,
  STATUS_TONE,
  displayOutreachPhone,
  isBusinessLine,
  renderTemplate,
  splitMessages,
  whatsappLinks,
  whatsappTemplateKey,
  type Templates,
} from "@/lib/sales/outreach-messages";
import { ActionButton, CallButton, InstagramButton, WhatsAppButton } from "./contact-buttons";

/** Las señales de la lista, sin lo que ya dice el teléfono (celular, compartido). */
const signals = (p: Outreach) =>
  p.signals
    .split(" · ")
    .filter((s) => s && !s.startsWith("celular ") && !s.startsWith("mismo teléfono") && s !== p.specialty)
    .join(" · ");

/**
 * Un fijo no tiene WhatsApp: no se le ofrece escribir. Si igual respondió o abrió su demo (era un
 * WhatsApp Business), se sigue la charla.
 */
export const landlineOnly = (p: Outreach) =>
  p.phone_kind === "fijo" && !p.opened_at && !p.demo_at && (p.status === "por_contactar" || p.status === "contactado" || p.status === "sin_canal");

/** El fijo, el celular del consultorio o un número de varios odontólogos: lo lee la recepción. */
export const isConsultorioLine = (p: Outreach) => isBusinessLine(p.phone_kind) || p.shared.length >= 2;

/**
 * Qué se le manda y por dónde, según el paso de la secuencia en que está (siempre a la recepción).
 * `early`: el próximo todavía no toca (el seguimiento antes de su día, o el Seguimiento 1 antes de las 24 h
 * del Paso 2); se puede adelantar desde la ficha, no desde la lista.
 */
export function contactPlan(p: Outreach, templates: Templates, link: string, today: string) {
  const closed = CLOSED.includes(p.status) || p.suppressed;
  const key = closed || !p.phone || landlineOnly(p) ? null : whatsappTemplateKey(p);
  const text = key ? renderTemplate(templates[key], p, link) : "";
  // Con «---» son dos mensajes: el chat se abre con el primero y el segundo se copia aparte.
  const parts = splitMessages(text);
  const whatsapp = key && p.phone ? { key, text, parts, ...whatsappLinks(p.phone, parts[0] ?? text) } : null;
  const instagram = !closed && p.instagram && p.touches < MAX_TOUCHES ? { handle: p.instagram, text: renderTemplate(templates.instagram, p, link) } : null;
  const waiting = key === "whatsapp_sin_respuesta" && Boolean(p.permission_at) && Date.now() - Date.parse(p.permission_at!) < PERMISSION_WAIT_HOURS * 3600_000;
  const early = waiting || (p.status === "contactado" && p.touches > 0 && Boolean(p.next_action_on && p.next_action_on > today));
  return { closed, whatsapp, instagram, early };
}

const WA_LABEL: Record<string, string> = {
  whatsapp_abridor: "Paso 1: saludar",
  whatsapp_permiso: "Paso 2: pedir permiso",
  whatsapp_entrega: "Paso 3: mandar la demo",
  whatsapp_sin_respuesta: "Seguimiento 1: mandar la demo",
  whatsapp_seguimiento: "Seguimiento 2",
  whatsapp_reenviable: "Seguimiento 3: para reenviar",
};

const waClass = "inline-flex items-center justify-center gap-1 rounded-full bg-[#15803d] px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-[#166534]";
const outlineClass = "inline-flex items-center justify-center rounded-full px-3 py-1.5 text-sm font-medium text-brand-800 ring-1 ring-brand-200 hover:bg-brand-50";

/** Se le mandó el saludo y todavía no la demo (le falta el Paso 2, o el 3 o el Seguimiento 1). */
export const awaitingPitch = (p: Outreach) => p.touches === 0 && Boolean(p.greeted_at);

/** En qué quedó quien todavía no recibió la demo. */
const pitchStatus = (p: Outreach) =>
  !p.permission_at ? "Saludado: cuando responda, el Paso 2"
  : p.last_reply_at && Date.parse(p.last_reply_at) > Date.parse(p.permission_at) ? "Respondió el Paso 2: mandale la demo (Paso 3)"
  : "Paso 2 enviado: si responde, el Paso 3; si no, el Seguimiento 1 a las 24 h";

export function OutreachRow({ p, templates, link, today }: { p: Outreach; templates: Templates; link: string; today: string }) {
  const plan = contactPlan(p, templates, link, today);
  const sharedTouched = p.shared.filter((s) => s.touched);
  return (
    <li className="flex flex-col gap-3 py-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0 lg:max-w-[58%]">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${p.priority === 1 ? "bg-brand-600 text-white" : p.priority === 2 ? "bg-brand-100 text-brand-800" : "bg-neutral-100 text-neutral-600"}`} title="Prioridad">
            P{p.priority}
          </span>
          <Link href={`/panel/prospeccion/${p.id}`} className="font-semibold text-brand-950 hover:underline">
            {p.title ? `${p.title} ` : ""}
            {p.name}
          </Link>
          {p.status !== "por_contactar" && <Badge tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Badge>}
          {p.demo_at ? <Badge tone="green">Probó la demo</Badge> : p.opened_at ? <Badge tone="blue">Abrió su demo</Badge> : null}
          {p.suppressed && p.status !== "baja" && <Badge tone="red">No contactar</Badge>}
        </div>
        <p className="mt-0.5 truncate text-sm text-brand-900/75">
          {[p.business_name, p.zone, p.specialty !== "Odontología" ? p.specialty : null].filter(Boolean).join(" · ")}
        </p>
        <p className="mt-0.5 text-xs text-brand-900/60">
          {p.phone ? `${displayOutreachPhone(p.phone)} (${p.phone_kind === "fijo" ? "fijo" : isConsultorioLine(p) ? "del consultorio" : "celular"})` : "Sin teléfono"}
          {p.instagram ? ` · @${p.instagram}` : ""}
          {signals(p) ? ` · ${signals(p)}` : ""}
        </p>
        {sharedTouched.length > 0 && p.touches === 0 && (
          <p className="mt-1 text-xs font-medium text-sun-700">Este número ya recibió un mensaje: {sharedTouched.map((s) => s.name).join(", ")}.</p>
        )}
        {p.first_contact_at && (
          <p className="mt-1 text-xs text-brand-900/60">
            {p.touches > 0 ? `${p.touches} ${p.touches === 1 ? "mensaje" : "mensajes"}` : awaitingPitch(p) ? pitchStatus(p) : "Contactado"}
            {p.last_channel ? ` · último por ${CHANNEL_LABEL[p.last_channel] ?? p.last_channel}, el ${formatDate(p.last_contact_at!)}` : ""}
            {p.next_action_on && !plan.closed
              ? p.next_action_on <= today
                ? " · toca hoy"
                : ` · próximo el ${p.next_action_on.split("-").reverse().slice(0, 2).join("/")}`
              : ""}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 lg:max-w-[42%] lg:justify-end">
        {plan.whatsapp && !plan.early && (
          <WhatsAppButton id={p.id} web={plan.whatsapp.web} app={plan.whatsapp.app} className={waClass}>
            {WA_LABEL[plan.whatsapp.key]}
          </WhatsAppButton>
        )}
        {plan.instagram && !plan.early && <InstagramButton id={p.id} handle={plan.instagram.handle} message={plan.instagram.text} className={outlineClass} />}
        {!plan.closed && p.phone && p.phone_kind === "fijo" && (
          <CallButton id={p.id} phone={p.phone} className={outlineClass}>
            Llamar
          </CallButton>
        )}
        {!plan.closed && !p.phone && !p.instagram && (
          <Link href={`/panel/prospeccion/${p.id}`} className={outlineClass}>
            Cargar un contacto
          </Link>
        )}
        {p.touches === 0 && p.status === "por_contactar" && (plan.whatsapp || plan.instagram) && (
          <ActionButton id={p.id} kind="touch" value={plan.whatsapp ? "whatsapp" : "instagram"} before className={smallButtonClass}>
            Ya le había escrito
          </ActionButton>
        )}
        {p.status === "contactado" && (
          <>
            {/* Que respondió el saludo o el Paso 2 lo lee la lectura de WhatsApp; si no lo vio, se marca a mano. */}
            <ActionButton id={p.id} kind="status" value="respondio" className={smallButtonClass}>
              Respondió
            </ActionButton>
            <ActionButton id={p.id} kind="status" value="no_interesa" className={smallButtonClass}>
              No le interesa
            </ActionButton>
            {p.last_channel === "whatsapp" && (
              <ActionButton id={p.id} kind="status" value="sin_canal" className={smallButtonClass}>
                No tiene WhatsApp
              </ActionButton>
            )}
          </>
        )}
        {p.first_contact_at && (
          <ActionButton id={p.id} kind="undo" value="" className={`${smallButtonClass} text-brand-900/70`}>
            Deshacer contacto
          </ActionButton>
        )}
        {(p.status === "respondio" || p.status === "reunion") && (
          <Link href={`/panel/prospeccion/${p.id}`} className={outlineClass}>
            Ver ficha
          </Link>
        )}
      </div>
    </li>
  );
}
