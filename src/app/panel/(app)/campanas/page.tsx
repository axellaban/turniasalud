import { getPanelClinic } from "@/lib/panel-clinic";
import Link from "next/link";
import { sql } from "@/lib/db";
import { CAMPAIGN_LABELS } from "@/lib/campaigns";
import { formatDateTime } from "@/lib/time";
import { CAMPAIGN_TYPES, type Campaign } from "@/lib/types";
import { createCampaignAction } from "../../actions";
import { Card, Empty, Field, Notice, PageHeader, StatusBadge, buttonClass, inputClass } from "@/components/ui";

export default async function CampaignsPage() {
  const clinic = await getPanelClinic();
  const campaigns = await sql<Array<Campaign & { sent: number; replied: number; booked: number }>>`
    select c.*,
      count(r.id) filter (where r.status not in ('pendiente', 'error'))::int as sent,
      count(r.id) filter (where r.status in ('respondio', 'agendo'))::int as replied,
      count(r.id) filter (where r.status = 'agendo')::int as booked
    from campaigns c left join campaign_recipients r on r.campaign_id = c.id
    where c.clinic_id = ${clinic.id}
    group by c.id
    order by c.created_at desc
    limit 50`;

  return (
    <>
      <PageHeader
        title="Campañas"
        description="Turnia Activa: le escribimos a tus pacientes por WhatsApp para llenar la agenda. Si responden, los atiende el agente."
      />
      {clinic.is_demo && <Notice tone="info" className="mb-6">Esta ficha es una demo: sus pacientes son de prueba, así que las campañas quedan deshabilitadas. Se activan cuando la clínica pasa a atender pacientes reales.</Notice>}
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          {campaigns.length ? (
            campaigns.map((c) => {
              const s = c;
              return (
                <Link key={c.id} href={`/panel/campanas/${c.id}`} className="block">
                  <Card className="hover:border-brand-300">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-xs text-brand-900/50">{CAMPAIGN_LABELS[c.type].label}</p>
                        <h2 className="font-semibold text-brand-950">{c.name}</h2>
                      </div>
                      <StatusBadge value={c.status} />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-5 text-sm text-brand-900/70">
                      <span>{s.sent} enviados</span>
                      <span>{s.replied} respondieron</span>
                      <span>{s.booked} agendaron</span>
                      <span className="text-brand-900/45">{formatDateTime(c.sent_at ?? c.created_at, clinic.timezone)}</span>
                    </div>
                  </Card>
                </Link>
              );
            })
          ) : (
            <Empty>Todavía no hay campañas. Creá la primera con el formulario.</Empty>
          )}

          <Card className="bg-brand-50/60">
            <h2 className="font-semibold text-brand-950">Automáticas (con n8n)</h2>
            <p className="mt-1 text-sm text-brand-900/70">
              Importá los workflows de la carpeta <code>n8n/</code> del repo y quedan corriendo solas: recordatorios diarios,
              recall semanal, recupero de ausentes y reactivación mensual. Cada corrida crea una campaña acá.
            </p>
          </Card>
        </div>

        <Card className="h-fit">
          <h2 className="mb-3 font-semibold text-brand-950">Nueva campaña</h2>
          <form action={createCampaignAction} className="space-y-3">
            <fieldset disabled={clinic.is_demo} className="space-y-3 disabled:opacity-60">
            <Field label="Tipo">
              <select name="type" className={inputClass} defaultValue="recall">
                {CAMPAIGN_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {CAMPAIGN_LABELS[t].label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Nombre">
              <input name="name" placeholder="Ej. Recall de limpiezas noviembre" className={inputClass} />
            </Field>
            <Field label="Template de WhatsApp" hint="Si lo dejás vacío se usa el template configurado para ese tipo.">
              <input name="template_name" placeholder="recall_control" className={inputClass} />
            </Field>
            <Field label="Objetivo para el agente" hint="Qué tiene que lograr el agente cuando el paciente responda.">
              <textarea name="goal" rows={3} className={inputClass} />
            </Field>
            <button className={`${buttonClass} w-full`}>Crear y revisar audiencia</button>
            </fieldset>
          </form>
        </Card>
      </div>
    </>
  );
}
