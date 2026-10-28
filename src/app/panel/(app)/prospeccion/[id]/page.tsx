import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/panel-clinic";
import { Badge, Card, PageHeader, ghostButtonClass, secondaryButtonClass, smallButtonClass } from "@/components/ui";
import { formatDateTime } from "@/lib/time";
import { getOutreach, outreachDemoUrl, outreachEvents, outreachSettings, todayKey, type OutreachEvent } from "@/lib/sales/outreach";
import { CHANNEL_LABEL, STATUS_LABEL, STATUS_TONE, displayOutreachPhone, googleSearchUrl, renderTemplate, type OutreachChannel, type OutreachStatus } from "@/lib/sales/outreach-messages";
import { ActionButton, CallButton, CopyButton, InstagramButton, WhatsAppButton } from "../contact-buttons";
import { contactPlan, isConsultorioLine } from "../outreach-row";
import { EditOutreachForm, NoteForm } from "./forms";

export const metadata: Metadata = { title: "Prospección · Panel" };

const EVENT_LABEL: Record<string, string> = {
  mensaje: "Mensaje",
  llamada: "Llamada",
  visita: "Visita",
  estado: "Estado",
  nota: "Nota",
  abrio: "Abrió su demo",
  demo: "Probó la demo",
};

/** «Mensaje · WhatsApp · seguimiento», «Estado · Respondió», «Nota · …». */
function eventText(e: OutreachEvent): string {
  const [status, ...rest] = e.detail.split(": ");
  const detail = e.kind === "estado" ? [STATUS_LABEL[status as OutreachStatus] ?? status, ...rest].join(": ") : e.detail;
  return [EVENT_LABEL[e.kind] ?? e.kind, e.channel ? (CHANNEL_LABEL[e.channel as OutreachChannel] ?? e.channel) : null, detail || null].filter(Boolean).join(" · ");
}

const STATUS_ACTIONS: OutreachStatus[] = ["respondio", "reunion", "cliente", "no_interesa", "sin_canal", "baja", "contactado", "por_contactar"];

export default async function OutreachDetailPage({ params }: PageProps<"/panel/prospeccion/[id]">) {
  await requireAdmin();
  const { id } = await params;
  const p = await getOutreach(id);
  if (!p) notFound();
  const [settings, events] = await Promise.all([outreachSettings(), outreachEvents(id)]);
  const link = outreachDemoUrl(p.code);
  const today = todayKey();
  const plan = contactPlan(p, settings.templates, link, today);
  const waClass = "inline-flex items-center justify-center gap-1 rounded-full bg-[#15803d] px-4 py-2 text-sm font-semibold text-white hover:bg-[#166534]";

  return (
    <>
      <Link href="/panel/prospeccion" className={`${ghostButtonClass} -ml-3 mb-2`}>
        ← Prospección
      </Link>
      <PageHeader
        title={`${p.title ? `${p.title} ` : ""}${p.name}`}
        description={[p.business_name, p.address, p.zone].filter(Boolean).join(" · ")}
        actions={<Badge tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Badge>}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <h2 className="font-display text-xl text-brand-950">Contactar</h2>
            {p.suppressed && <p className="mt-2 text-sm font-medium text-red-700">Pidió no recibir más mensajes: no se le escribe ni lo llama Sofi.</p>}
            {p.phone && (p.shared.length > 0 || isConsultorioLine(p)) && (
              <p className="mt-2 text-sm text-brand-900/75">
                {p.shared.length > 0 && `Mismo teléfono que ${p.shared.map((s) => `${s.name}${s.touched ? " (ya contactado)" : ""}`).join(", ")}. `}
                {isConsultorioLine(p) ? "Es el número del consultorio: el mensaje le pide a la recepción que se lo pase." : ""}
              </p>
            )}
            {plan.whatsapp ? (
              <div className="mt-4">
                <p className="text-sm font-medium text-brand-900">WhatsApp · {displayOutreachPhone(p.phone)}</p>
                {plan.early && (
                  <p className="mt-1 text-sm text-brand-900/75">
                    El seguimiento toca el {p.next_action_on!.split("-").reverse().slice(0, 2).join("/")}. Si te respondió, marcalo abajo; si querés, podés adelantarlo.
                  </p>
                )}
                <p className="mt-2 whitespace-pre-line rounded-2xl rounded-tl-md bg-[#dcf8c6] px-3.5 py-2.5 text-[15px] leading-snug text-brand-950">{plan.whatsapp.text}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <WhatsAppButton id={p.id} web={plan.whatsapp.web} app={plan.whatsapp.app} className={plan.early ? secondaryButtonClass : waClass}>
                    {plan.early ? "Adelantar el seguimiento" : "Abrir el chat con este mensaje"}
                  </WhatsAppButton>
                  <CopyButton text={plan.whatsapp.text} className={smallButtonClass}>
                    Copiar el mensaje
                  </CopyButton>
                </div>
                <p className="mt-2 text-xs text-brand-900/60">
                  {plan.whatsapp.key.startsWith("whatsapp_saludo")
                    ? "Primero el saludo, sin link: así WhatsApp no bloquea tu número. Al abrirlo queda registrado y, cuando te responda, acá aparece la presentación con su demo."
                    : "Lo mandás vos desde tu WhatsApp. Al abrirlo queda registrado y el seguimiento se programa solo (dos días hábiles; después, cuatro)."}
                </p>
              </div>
            ) : (
              !plan.closed && p.phone && <p className="mt-3 text-sm text-brand-900/70">Ya le escribiste tres veces por WhatsApp. Mejor esperar a que responda.</p>
            )}
            {plan.instagram && (
              <div className="mt-5">
                <p className="text-sm font-medium text-brand-900">Instagram · @{plan.instagram.handle}</p>
                <p className="mt-2 whitespace-pre-line rounded-2xl bg-brand-50 px-3.5 py-2.5 text-[15px] leading-snug text-brand-950">{plan.instagram.text}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <InstagramButton id={p.id} handle={plan.instagram.handle} message={plan.instagram.text} className={secondaryButtonClass} />
                </div>
              </div>
            )}
            {!plan.closed && p.phone && (
              <details className="mt-5">
                <summary className="cursor-pointer text-sm font-medium text-brand-700">Llamar · guion</summary>
                <p className="mt-2 rounded-xl bg-neutral-50 px-3.5 py-2.5 text-sm leading-relaxed text-brand-950">
                  {renderTemplate(settings.templates.llamada, p, link)}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <CallButton id={p.id} phone={p.phone} className={secondaryButtonClass}>
                    Llamar al {displayOutreachPhone(p.phone)}
                  </CallButton>
                  <ActionButton id={p.id} kind="touch" value="persona" className={smallButtonClass}>
                    Lo visité
                  </ActionButton>
                </div>
              </details>
            )}
            <div className="mt-6 border-t border-brand-900/5 pt-4">
              <p className="text-sm font-medium text-brand-900">Estado</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {STATUS_ACTIONS.filter((s) => s !== p.status).map((s) => (
                  <ActionButton key={s} id={p.id} kind="status" value={s} className={smallButtonClass}>
                    {STATUS_LABEL[s]}
                  </ActionButton>
                ))}
              </div>
              {events.some((e) => e.kind === "mensaje" || e.kind === "llamada" || e.kind === "visita") && (
                <div className="mt-3">
                  <ActionButton id={p.id} kind="undo" value="" className={smallButtonClass}>
                    Deshacer el último contacto
                  </ActionButton>
                </div>
              )}
              <p className="mt-2 text-xs text-brand-900/60">
                «Deshacer» borra el último mensaje, llamada o visita registrados (si fue una prueba o no lo mandaste). «Pidió no recibir más» lo saca de
                la lista para siempre, también de las llamadas de Sofi.
              </p>
            </div>
          </Card>

          <Card>
            <h2 className="font-display text-xl text-brand-950">Datos</h2>
            <p className="mt-1 text-sm text-brand-900/70">El saludo y el consultorio se usan en el mensaje y en su demo.</p>
            <EditOutreachForm p={p} />
          </Card>
        </div>

        <aside className="min-w-0 space-y-6">
          <Card>
            <h2 className="font-semibold text-brand-950">Su demo</h2>
            <p className="mt-1 break-all text-sm text-brand-700">{link}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <CopyButton text={link} className={smallButtonClass}>
                Copiar link
              </CopyButton>
              <a href={`/p/${p.code}?vista=panel`} target="_blank" rel="noreferrer" className={smallButtonClass}>
                Ver lo que recibe
              </a>
            </div>
            <ul className="mt-3 space-y-1 text-sm text-brand-900/75">
              <li>{p.opened_at ? `La abrió ${p.opens === 1 ? "una vez" : `${p.opens} veces`}; la primera, el ${formatDateTime(p.opened_at)}.` : "Todavía no la abrió."}</li>
              {p.demo_at && <li>La probó el {formatDateTime(p.demo_at)}.{p.lead_id ? " Está en Pedidos de demo." : ""}</li>}
            </ul>
          </Card>

          <Card>
            <h2 className="font-semibold text-brand-950">Buscar más datos</h2>
            <p className="mt-1 text-sm text-brand-900/70">Su Instagram personal o su web: lo lee la persona que decide, no la recepción.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a href={googleSearchUrl(p, true)} target="_blank" rel="noreferrer" className={smallButtonClass}>
                Buscar su Instagram
              </a>
              <a href={googleSearchUrl(p)} target="_blank" rel="noreferrer" className={smallButtonClass}>
                Buscar en Google
              </a>
            </div>
            {p.signals && <p className="mt-3 text-xs text-brand-900/65">{p.signals}</p>}
            {p.source && <p className="mt-1 text-xs text-brand-900/65">Fuente: {p.source}</p>}
          </Card>

          <Card>
            <h2 className="font-semibold text-brand-950">Historia</h2>
            <NoteForm id={p.id} />
            {events.length === 0 ? (
              <p className="mt-3 text-sm text-brand-900/60">Sin contactos todavía.</p>
            ) : (
              <ol className="mt-3 space-y-2 text-sm">
                {events.map((e) => (
                  <li key={e.id} className="border-l-2 border-brand-100 pl-3">
                    <p className="text-xs text-brand-900/65">{formatDateTime(e.created_at)}</p>
                    <p className="text-brand-950">{eventText(e)}</p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </aside>
      </div>
    </>
  );
}
