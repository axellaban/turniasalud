import Link from "next/link";
import { Badge, smallButtonClass } from "@/components/ui";
import { formatDate } from "@/lib/time";
import type { Outreach } from "@/lib/sales/outreach";
import {
  CHANNEL_LABEL,
  CLOSED,
  MAX_TOUCHES,
  STATUS_LABEL,
  STATUS_TONE,
  displayOutreachPhone,
  isBusinessLine,
  renderTemplate,
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

/** El fijo, el celular del consultorio o un número de varios odontólogos: lo lee la recepción. */
export const isConsultorioLine = (p: Outreach) => isBusinessLine(p.phone_kind) || p.shared.length >= 2;

/**
 * Qué se le manda y por dónde, según cuántas veces se le escribió y si probó la demo. `early`: el
 * seguimiento todavía no toca (se puede adelantar desde la ficha, no desde la lista).
 */
export function contactPlan(p: Outreach, templates: Templates, link: string, today: string) {
  const closed = CLOSED.includes(p.status) || p.suppressed;
  const key = closed || !p.phone ? null : whatsappTemplateKey(p, isConsultorioLine(p));
  const text = key ? renderTemplate(templates[key], p, link) : "";
  const whatsapp = key && p.phone ? { key, text, ...whatsappLinks(p.phone, text) } : null;
  const instagram = !closed && p.instagram && p.touches < MAX_TOUCHES ? { handle: p.instagram, text: renderTemplate(templates.instagram, p, link) } : null;
  const early = p.status === "contactado" && p.touches > 0 && Boolean(p.next_action_on && p.next_action_on > today);
  return { closed, whatsapp, instagram, early };
}

const WA_LABEL: Record<string, string> = {
  whatsapp_saludo: "Saludar por WhatsApp",
  whatsapp_saludo_consultorio: "Saludar al consultorio",
  whatsapp_1: "Mandar la demo",
  whatsapp_consultorio: "Mandar la demo al consultorio",
  whatsapp_2: "Mandar seguimiento",
  whatsapp_3: "Mandar el último",
  whatsapp_demo: "Preguntar por la demo",
};

const waClass = "inline-flex items-center justify-center gap-1 rounded-full bg-[#15803d] px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-[#166534]";
const outlineClass = "inline-flex items-center justify-center rounded-full px-3 py-1.5 text-sm font-medium text-brand-800 ring-1 ring-brand-200 hover:bg-brand-50";

/** Se le mandó el saludo y todavía no la presentación con la demo. */
export const awaitingPitch = (p: Outreach) => p.touches === 0 && Boolean(p.greeted_at);

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
            {p.touches > 0 ? `${p.touches} ${p.touches === 1 ? "mensaje" : "mensajes"}` : awaitingPitch(p) ? "Saludado: cuando responda, mandale la demo" : "Contactado"}
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
        {p.touches === 0 && p.status === "por_contactar" && (p.phone || p.instagram) && (
          <ActionButton id={p.id} kind="touch" value={p.phone ? "whatsapp" : "instagram"} before className={smallButtonClass}>
            Ya le había escrito
          </ActionButton>
        )}
        {p.status === "contactado" && (
          <>
            {!awaitingPitch(p) && (
              <ActionButton id={p.id} kind="status" value="respondio" className={smallButtonClass}>
                Respondió
              </ActionButton>
            )}
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
