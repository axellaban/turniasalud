import { getPanelClinic } from "@/lib/panel-clinic";
import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { isUuid } from "@/lib/clinic";
import { CAMPAIGN_LABELS, computeAudience } from "@/lib/campaigns";
import { formatDateTime } from "@/lib/time";
import { displayPhone } from "@/lib/phone";
import type { Campaign } from "@/lib/types";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { SendCampaignButton } from "./send-button";
import { renderTemplate, templateKeyFor, whatsappReadiness } from "@/lib/whatsapp";

export default async function CampaignDetail({ params }: PageProps<"/panel/campanas/[id]">) {
  const { id } = await params;
  const clinic = await getPanelClinic();
  const [campaign] = isUuid(id) ? await sql<Campaign[]>`select * from campaigns where id = ${id} and clinic_id = ${clinic.id}` : [];
  if (!campaign) notFound();
  const [audience, sentRows] = await Promise.all([
    computeAudience(clinic, campaign.type),
    sql<Array<{ id: string; status: string; error: string | null; sent_at: string | null; full_name: string | null; phone: string }>>`
      select r.id, r.status, r.error, r.sent_at, p.full_name, p.phone
      from campaign_recipients r join patients p on p.id = r.patient_id
      where r.campaign_id = ${campaign.id}
      order by r.sent_at desc nulls last`,
  ]);
  const missingSetup = whatsappReadiness(clinic);
  const waha = clinic.whatsapp_provider === "waha";

  return (
    <>
      <Link href="/panel/campanas" className="text-sm text-brand-700 hover:underline">
        ← Campañas
      </Link>
      <PageHeader
        title={campaign.name}
        description={`${CAMPAIGN_LABELS[campaign.type].label} · ${waha ? "por WAHA" : `template “${campaign.template_name}” (${campaign.template_language})`}`}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-brand-950">Audiencia ahora ({audience.length})</h2>
            <StatusBadge value={campaign.status} />
          </div>
          <p className="mb-3 text-sm text-brand-900/60">{CAMPAIGN_LABELS[campaign.type].description}</p>
          <ul className="max-h-80 space-y-2 overflow-y-auto text-sm">
            {audience.map((a) => (
              <li key={a.patient_id} className="rounded-xl bg-brand-50/60 p-2">
                <p className="font-medium text-brand-950">
                  {a.name ?? "Sin nombre"} <span className="font-normal text-brand-900/50">· {displayPhone(a.phone)}</span>
                </p>
                <p className="text-xs text-brand-900/60">{a.detail}</p>
              </li>
            ))}
            {!audience.length && <li className="text-brand-900/50">Nadie cumple las condiciones en este momento.</li>}
          </ul>
          <div className="mt-4">
            {missingSetup ? (
              <p className="rounded-xl bg-sun-100 p-3 text-sm">
                Para enviar: {missingSetup} Revisalo en <Link href="/panel/configuracion" className="underline">Configuración</Link>.
              </p>
            ) : (
              <SendCampaignButton id={campaign.id} count={audience.length} />
            )}
          </div>
          {waha ? (
            <p className="mt-3 text-xs text-brand-900/50">
              Por WAHA se manda este texto, con una pausa entre mensajes (hasta 50 por vez):{" "}
              <q>{renderTemplate(templateKeyFor(campaign.type), ["María", "…"], { optOutFooter: true })}</q>
            </p>
          ) : (
            <p className="mt-3 text-xs text-brand-900/50">
              El template tiene que estar aprobado por Meta y usar dos variables: {"{{1}}"} = nombre y {"{{2}}"} = detalle (fecha del turno, control,
              etc.). Se envían hasta 50 por vez.
            </p>
          )}
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold text-brand-950">Envíos ({sentRows.length})</h2>
          <ul className="divide-y divide-brand-900/5 text-sm">
            {sentRows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="flex-1">{r.full_name ?? displayPhone(r.phone)}</span>
                <span className="text-xs text-brand-900/50">{r.sent_at ? formatDateTime(r.sent_at, clinic.timezone) : ""}</span>
                <StatusBadge value={r.status} />
                {r.error && <p className="w-full text-xs text-red-600">{r.error}</p>}
              </li>
            ))}
            {!sentRows.length && <li className="py-2 text-brand-900/50">Todavía no se envió.</li>}
          </ul>
        </Card>
      </div>
    </>
  );
}
