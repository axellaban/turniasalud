import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { sql } from "@/lib/db";
import { isUuid } from "@/lib/clinic";
import { getPanelClinic } from "@/lib/panel-clinic";
import { campaignLot } from "@/lib/campaign-lot";
import { DAILY_LINE_CAP, LOT_SIZE, PILOT_SIZE, SEND_WINDOW, inSendWindow, lineUsage } from "@/lib/campaign-limits";
import { whatsappReadiness } from "@/lib/whatsapp";
import { CAMPAIGN_LABELS } from "@/lib/campaigns";
import type { Campaign } from "@/lib/types";
import { LotReview } from "./lot-review";

export const metadata: Metadata = { title: "Revisar lote · Campañas" };

export default async function LotPage({ params }: PageProps<"/panel/campanas/[id]/lote">) {
  const { id } = await params;
  const clinic = await getPanelClinic();
  const [campaign] = isUuid(id) ? await sql<Campaign[]>`select * from campaigns where id = ${id} and clinic_id = ${clinic.id}` : [];
  if (!campaign) notFound();
  const [lot, usage] = await Promise.all([campaignLot(clinic, campaign), lineUsage(clinic)]);
  const sofiProblem = clinic.is_demo ? "Es un perfil de demo: Sofi no envía nada desde acá." : whatsappReadiness(clinic);
  return (
    <>
      <p className="mb-2 text-sm">
        <Link href={`/panel/campanas?campana=${campaign.id}#campana`} className="text-brand-700 hover:underline">
          ← {campaign.name}
        </Link>
      </p>
      <LotReview
        clinicId={clinic.id}
        campaignId={campaign.id}
        title={`Revisar lote · ${lot.items.length} ${lot.items.length === 1 ? "paciente" : "pacientes"}`}
        subtitle={`${CAMPAIGN_LABELS[campaign.type].label}${lot.pilot ? ` · piloto: ${lot.pilot.contacted} de ${lot.pilot.size}` : ""} · quedan ${lot.pending} sin el primer mensaje`}
        items={lot.items}
        sent={lot.sent}
        pilot={lot.pilot}
        pilotSize={PILOT_SIZE}
        lotSize={LOT_SIZE}
        sofiProblem={sofiProblem}
        usage={usage.capped ? { sent: usage.sent, cap: DAILY_LINE_CAP } : null}
        windowLabel={`lunes a viernes, de ${SEND_WINDOW.from} a ${SEND_WINDOW.to}`}
        inWindow={inSendWindow(clinic)}
      />
    </>
  );
}
