import { getPanelClinic } from "@/lib/panel-clinic";
import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { isUuid } from "@/lib/clinic";
import { CAMPAIGN_LABELS, campaignRule, campaignStats, EMPTY_STATS, firstName, manualMessage, NOT_REACHABLE, whatsappLinks } from "@/lib/campaigns";
import { messagingSettings } from "@/lib/messaging-settings";
import { formatDateTime } from "@/lib/time";
import { displayPhone } from "@/lib/phone";
import type { Campaign, CampaignRecipient } from "@/lib/types";
import { Badge, Card, Notice, buttonClass, ghostButtonClass, smallButtonClass } from "@/components/ui";
import { TEMPLATE_TEXTS, templateKeyFor, whatsappReadiness } from "@/lib/whatsapp";
import { discardCampaignAction, refreshAudienceAction, toggleRecipientAction } from "../../../campaign-actions";
import { SendCampaignButton } from "./send-button";
import { MessageEditor } from "./message-editor";
import { WhatsAppButton } from "./whatsapp-button";
import { CAMPAIGN_STATUS, RECIPIENT_STATUS, money, plural } from "../labels";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Campaña · Panel" };

const GROUPS = {
  "por-enviar": { label: "Por enviar", statuses: ["pendiente", "error"] },
  enviados: { label: "Enviados", statuses: ["enviado", "respondio", "agendo"] },
  fuera: { label: "Fuera de la lista", statuses: ["excluido"] },
} as const;
type Group = keyof typeof GROUPS;

type Row = Pick<CampaignRecipient, "id" | "status" | "error" | "sent_at" | "detail" | "manual"> & {
  patient_id: string;
  full_name: string | null;
  phone: string;
  booked: boolean;
};

const WA_BUTTON = "inline-flex items-center justify-center gap-1.5 rounded-full bg-[#15803d] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#166534]";

function WhatsAppIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 2.2a9.7 9.7 0 0 0-8.4 14.6L2.2 21.8l5.1-1.3A9.7 9.7 0 1 0 12 2.2zm0 17.7a8 8 0 0 1-4.1-1.1l-.3-.2-3 .8.8-3-.2-.3A8 8 0 1 1 12 19.9zm4.4-6c-.2-.1-1.4-.7-1.7-.8-.2-.1-.4-.1-.5.1l-.8.9c-.1.2-.3.2-.5.1a6.6 6.6 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.5-.4h-.5a.9.9 0 0 0-.7.3 2.8 2.8 0 0 0-.9 2.1 4.9 4.9 0 0 0 1 2.6 11.2 11.2 0 0 0 4.3 3.8c1.6.7 2.2.8 3 .6a2.6 2.6 0 0 0 1.7-1.2 2.1 2.1 0 0 0 .2-1.2c-.1-.1-.3-.2-.5-.3z" />
    </svg>
  );
}

export default async function CampaignDetail({ params, searchParams }: PageProps<"/panel/campanas/[id]">) {
  const { id } = await params;
  const { ver } = await searchParams;
  const clinic = await getPanelClinic();
  const [campaign] = isUuid(id) ? await sql<Campaign[]>`select * from campaigns where id = ${id} and clinic_id = ${clinic.id}` : [];
  if (!campaign) notFound();

  const [statsMap, settings, [next], [sample]] = await Promise.all([
    campaignStats(clinic.id, [campaign.id]),
    messagingSettings(),
    // El próximo al que hay que escribirle desde el WhatsApp de la clínica (en el orden de la lista).
    sql<Array<{ id: string; full_name: string | null; phone: string; detail: string | null }>>`
      select r.id, p.full_name, p.phone, r.detail from campaign_recipients r join patients p on p.id = r.patient_id
      where r.campaign_id = ${campaign.id} and r.status = 'pendiente'
      order by p.full_name nulls last, r.id limit 1`,
    sql<Array<{ full_name: string | null; detail: string | null }>>`
      select p.full_name, r.detail from campaign_recipients r join patients p on p.id = r.patient_id
      where r.campaign_id = ${campaign.id} order by p.full_name nulls last, r.id limit 1`,
  ]);
  const first = next ?? sample;
  const stats = statsMap.get(campaign.id) ?? EMPTY_STATS;
  const toSend = stats.pending + stats.errors;
  const counts: Record<Group, number> = { "por-enviar": toSend, enviados: stats.sent, fuera: stats.excluded };
  const group: Group = typeof ver === "string" && ver in GROUPS ? (ver as Group) : toSend ? "por-enviar" : stats.sent ? "enviados" : "por-enviar";

  const rows = await sql<Row[]>`
    select r.id, r.status, r.error, r.sent_at, r.detail, r.manual, r.patient_id, p.full_name, p.phone,
      exists (
        select 1 from appointments a
        where a.patient_id = r.patient_id and r.sent_at is not null and a.created_at >= r.sent_at and a.status <> 'cancelado'
      ) as booked
    from campaign_recipients r join patients p on p.id = r.patient_id
    where r.campaign_id = ${campaign.id} and r.status = any(${[...GROUPS[group].statuses]}::text[])
    order by p.full_name nulls last, r.id
    limit 300`;

  const key = templateKeyFor(campaign.type);
  const official = clinic.whatsapp_provider === "meta" ? campaign.template_name : null;
  const exampleDetail = first?.detail ?? clinic.name;
  const preview = manualMessage(campaign, first?.full_name ?? "María", exampleDetail);
  const suggested = TEMPLATE_TEXTS[key].replace("{{1}}", "{nombre}").replace("{{2}}", "{detalle}");
  const setupProblem = whatsappReadiness(clinic) ?? (settings.active_channel !== "whatsapp" ? "WhatsApp todavía no está conectado a Sofi." : null);
  const status = CAMPAIGN_STATUS[campaign.status];
  const nextButton = next && (
    <WhatsAppButton
      clinicId={clinic.id}
      recipientId={next.id}
      {...whatsappLinks(next.phone, manualMessage(campaign, next.full_name, next.detail ?? clinic.name))}
      className={`${buttonClass} w-full !bg-[#15803d] hover:!bg-[#166534]`}
    >
      <WhatsAppIcon /> Abrir el chat con {firstName(next.full_name) === "hola" ? "el próximo" : firstName(next.full_name)}
    </WhatsAppButton>
  );
  const discardable = campaign.status === "borrador" && stats.sent === 0;

  const tiles: Array<[string, string, string?]> = [
    ["Por enviar", toSend.toLocaleString("es-AR")],
    ["Enviados", stats.sent.toLocaleString("es-AR"), stats.sent ? undefined : "todavía nadie"],
    ["Respondieron", stats.replied.toLocaleString("es-AR"), stats.sent ? `${Math.round((stats.replied / stats.sent) * 100)}% de los enviados` : undefined],
    ["Sacaron turno", stats.booked.toLocaleString("es-AR"), stats.attended ? `${stats.attended} ya vinieron` : undefined],
    ["Valor de esos turnos", stats.value ? money.format(stats.value) : "—", stats.value ? "con tus precios de referencia" : undefined],
  ];

  return (
    <>
      <Link href="/panel/campanas" className="text-sm text-brand-700 hover:underline">
        ← Campañas
      </Link>
      <div className="mb-6 mt-2 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-brand-900/60">{CAMPAIGN_LABELS[campaign.type].label}</p>
          <h1 className="mt-1 flex flex-wrap items-center gap-3 font-display text-2xl tracking-tight text-brand-950 sm:text-3xl">
            {campaign.name} <Badge tone={status.tone}>{status.label}</Badge>
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-brand-900/60">{campaignRule(campaign.type, clinic)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <form action={refreshAudienceAction}>
            <input type="hidden" name="clinic_id" value={clinic.id} />
            <input type="hidden" name="id" value={campaign.id} />
            <button className={ghostButtonClass}>Actualizar la lista</button>
          </form>
          {discardable && (
            <form action={discardCampaignAction}>
              <input type="hidden" name="clinic_id" value={clinic.id} />
              <input type="hidden" name="id" value={campaign.id} />
              <button className={`${ghostButtonClass} text-red-700 hover:bg-red-50`}>Descartar</button>
            </form>
          )}
        </div>
      </div>

      <Card className="mb-6 p-0">
        <dl className="grid grid-cols-2 divide-brand-900/5 sm:grid-cols-5 sm:divide-x">
          {tiles.map(([label, value, hint]) => (
            <div key={label} className="px-5 py-4">
              <dt className="text-xs font-medium text-brand-900/65">{label}</dt>
              <dd className="mt-1 font-display text-2xl tabular-nums text-brand-950">{value}</dd>
              {hint && <dd className="text-xs text-brand-900/60">{hint}</dd>}
            </div>
          ))}
        </dl>
      </Card>

      {nextButton && (
        <div className="mb-4 lg:hidden">
          {nextButton}
          <p className="mt-1.5 text-center text-xs text-brand-900/60">Se abre WhatsApp con el mensaje escrito: vos tocás Enviar.</p>
        </div>
      )}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="min-w-0 p-0">
          <nav aria-label="Destinatarios" className="flex gap-1 overflow-x-auto border-b border-brand-900/10 px-3">
            {(Object.keys(GROUPS) as Group[]).map((g) => (
              <Link
                key={g}
                href={`/panel/campanas/${campaign.id}?ver=${g}`}
                aria-current={g === group ? "page" : undefined}
                className={`-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-3 text-sm font-medium ${
                  g === group ? "border-brand-600 text-brand-700" : "border-transparent text-brand-900/60 hover:text-brand-900"
                }`}
              >
                {GROUPS[g].label}
                <span className="rounded-full bg-brand-50 px-1.5 text-xs text-brand-700">{counts[g]}</span>
              </Link>
            ))}
          </nav>
          {rows.length ? (
            <ul className="divide-y divide-brand-900/5">
              {rows.map((r) => {
                const shown = r.booked && r.status !== "agendo" ? RECIPIENT_STATUS.agendo : RECIPIENT_STATUS[r.status];
                const links = whatsappLinks(r.phone, manualMessage(campaign, r.full_name, r.detail ?? clinic.name));
                const sendable = r.status === "pendiente" || r.status === "error";
                return (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
                    <div className="min-w-0 flex-1 basis-56">
                      <Link href={`/panel/pacientes/${r.patient_id}`} className="font-medium text-brand-950 hover:underline">
                        {r.full_name ?? "Sin nombre"}
                      </Link>
                      <p className="truncate text-xs text-brand-900/60">
                        {displayPhone(r.phone)}
                        {r.detail && r.detail !== clinic.name ? ` · ${r.detail}` : ""}
                        {r.sent_at ? ` · ${r.manual ? "desde tu WhatsApp" : "por Sofi"} el ${formatDateTime(r.sent_at, clinic.timezone)}` : ""}
                      </p>
                      {r.error && <p className={`text-xs ${r.status === "error" ? "text-red-600" : "text-brand-900/60"}`}>{r.error}</p>}
                    </div>
                    {r.status !== "pendiente" && <Badge tone={shown.tone}>{shown.label}</Badge>}
                    {sendable && (
                      <>
                        <WhatsAppButton clinicId={clinic.id} recipientId={r.id} web={links.web} app={links.app} className={WA_BUTTON}>
                          <WhatsAppIcon className="h-3.5 w-3.5" /> Abrir chat
                        </WhatsAppButton>
                        <form action={toggleRecipientAction}>
                          <input type="hidden" name="clinic_id" value={clinic.id} />
                          <input type="hidden" name="campaign_id" value={campaign.id} />
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="include" value="false" />
                          <button className={smallButtonClass} aria-label={`Quitar a ${r.full_name ?? "este paciente"} de la lista`}>
                            Quitar
                          </button>
                        </form>
                      </>
                    )}
                    {r.status === "excluido" && r.error === NOT_REACHABLE && (
                      <Link href={`/panel/pacientes/${r.patient_id}`} className={smallButtonClass}>
                        Ver ficha
                      </Link>
                    )}
                    {r.status === "enviado" && r.manual && !r.booked && (
                      <form action={toggleRecipientAction}>
                        <input type="hidden" name="clinic_id" value={clinic.id} />
                        <input type="hidden" name="campaign_id" value={campaign.id} />
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="include" value="true" />
                        <button className={smallButtonClass} title="Vuelve a «Por enviar»">
                          No lo mandé
                        </button>
                      </form>
                    )}
                    {r.status === "excluido" && !r.error && (
                      <form action={toggleRecipientAction}>
                        <input type="hidden" name="clinic_id" value={clinic.id} />
                        <input type="hidden" name="campaign_id" value={campaign.id} />
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="include" value="true" />
                        <button className={smallButtonClass}>Volver a sumar</button>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="p-6 text-sm text-brand-900/65">
              {group === "por-enviar"
                ? stats.sent
                  ? "Ya les escribiste a todos. Si alguien nuevo cumple las condiciones, tocá «Actualizar la lista»."
                  : "Nadie cumple las condiciones en este momento."
                : group === "enviados"
                  ? "Todavía no se envió a nadie."
                  : "No quitaste a nadie de la lista."}
            </p>
          )}
          {counts[group] > rows.length && <p className="border-t border-brand-900/5 px-5 py-3 text-xs text-brand-900/60">Se muestran los primeros {rows.length} de {counts[group]}.</p>}
        </Card>

        <div className="space-y-6 lg:sticky lg:top-20 lg:self-start">
          <Card>
            <h2 className="font-semibold text-brand-950">Enviar</h2>
            <p className="mt-1 text-sm text-brand-900/65">
              <strong className="font-medium text-brand-950">Desde tu WhatsApp:</strong> se abre el chat con el mensaje escrito y vos tocás Enviar. Las
              respuestas te llegan a vos; si saca turno, lo contamos acá.
            </p>
            {next ? (
              <div className="mt-4">{nextButton}</div>
            ) : (
              <p className="mt-3 text-sm text-brand-900/65">{toSend ? "Abrí «Por enviar» para seguir." : "No queda nadie por enviar."}</p>
            )}
            {toSend > 1 && next && <p className="mt-2 text-xs text-brand-900/60">Después de cada uno aparece el siguiente. Quedan {plural(toSend, "paciente", "pacientes")}.</p>}
            <div className="mt-5 border-t border-brand-900/5 pt-4">
              <p className="text-sm text-brand-900/65">
                <strong className="font-medium text-brand-950">Con Sofi, automático:</strong> le escribe a cada uno (de a 50, con pausas) y atiende las
                respuestas con el contexto de la campaña.
              </p>
              <div className="mt-3">
                {clinic.is_demo ? (
                  <Notice tone="info">En un perfil de demo, Sofi no envía mensajes.</Notice>
                ) : setupProblem ? (
                  <Notice tone="warning">{setupProblem}</Notice>
                ) : (
                  <SendCampaignButton clinicId={clinic.id} id={campaign.id} count={toSend} />
                )}
              </div>
            </div>
          </Card>

          <Card>
            <h2 className="font-semibold text-brand-950">Mensaje</h2>
            <p className="mt-1 text-xs text-brand-900/60">Así le llega a {first?.full_name ? firstName(first.full_name) : "cada paciente"}:</p>
            <div className="mt-3 rounded-2xl bg-[#e9f7ef] p-3">
              <p className="whitespace-pre-line rounded-xl rounded-tr-sm bg-white px-3 py-2 text-sm text-brand-950 shadow-sm">{preview}</p>
            </div>
            <p className="mt-3 text-xs text-brand-900/65">
              <span className="font-medium text-brand-900">Si responde, Sofi:</span> {campaign.goal}
            </p>
            <MessageEditor
              clinicId={clinic.id}
              campaignId={campaign.id}
              message={campaign.message}
              suggested={suggested}
              goal={campaign.goal ?? CAMPAIGN_LABELS[campaign.type].goal}
              example={exampleDetail}
              official={official}
            />
          </Card>
        </div>
      </div>
    </>
  );
}
