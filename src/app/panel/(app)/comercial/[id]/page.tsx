import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { isUuid } from "@/lib/clinic";
import { requireAdmin } from "@/lib/panel-clinic";
import { budgetToday, salesSettings, type Prospect, type SalesCall } from "@/lib/sales/service";
import { salesCallBlockers } from "@/lib/sales/availability";
import { Badge, Card, PageHeader, Empty, Notice, Field, inputClass } from "@/components/ui";
import { SalesForm } from "../form";
import { ReviewFields } from "../fields";

export const maxDuration = 60;

export default async function SalesProspectPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [p] = await sql<Prospect[]>`select p.*, exists(select 1 from sales_suppressions b where b.phone = p.phone) as suppressed from sales_prospects p where id = ${id}`;
  if (!p) notFound();
  const [s,b,calls,pending] = await Promise.all([salesSettings(),budgetToday(),sql<SalesCall[]>`select * from sales_calls where prospect_id = ${id} order by created_at desc limit 50`,sql`select id from sales_calls where status in ('iniciando','en_curso','incierta') limit 1`]);
  const blockers = salesCallBlockers(s,b,pending.length>0,!!process.env.ELEVENLABS_PHONE_NUMBER_ID,p);
  const enabled = blockers.length === 0;
  const demoUrl = `/probar-demo?web=${encodeURIComponent(p.website)}`;
  return <>
    <PageHeader title={p.business_name} description={p.phone} actions={<Link className="underline" href="/panel/comercial">Volver a Comercial</Link>} />
    {p.suppressed && <Notice tone="warning">Este número está dado de baja. No se permiten nuevas llamadas, tampoco desde una ficha duplicada.</Notice>}
    <div className="grid gap-6 xl:grid-cols-2 my-6">
      <Card id="contacto"><h2 className="font-display text-xl mb-4">Contexto y contacto</h2><p className="mb-4 text-sm break-all">{p.website}</p>
        <SalesForm intent="review" label="Guardar contexto y revisión"><input type="hidden" name="id" value={id} /><ReviewFields eligibility={p.eligibility} evidence={p.evidence} context={p.context} /></SalesForm>
      </Card>
      <div className="space-y-6">
        <Card><h2 className="font-display text-xl mb-3">Llamada manual</h2><p className="text-sm mb-4">Destino: <strong>{p.phone}</strong>. Sofi ofrece una demo personalizada y charla con Axel. Límite de 60 segundos de conversación, más despedida; reserva de US$1. No se envían mensajes ni se reintenta automáticamente.</p><p className="text-sm mb-4">Las llamadas telefónicas nuevas se solicitan con grabación en Twilio. <a href="https://www.twilio.com/console/voice/recordings/recording-logs?x-target-region=us1&__override_layout__=embed" target="_blank" rel="noopener noreferrer" className="underline">Abrir grabaciones de Twilio</a>. La grabación y el almacenamiento tienen cargo adicional por uso; el cupo del panel no es una factura.</p>
          {!enabled && <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4"><h3 className="font-semibold text-sm">Qué falta para poder llamar</h3><ul className="mt-2 space-y-3">{blockers.map(block=><li key={block.message} className="text-sm"><p>{block.message}</p><Link className="underline font-semibold" href={block.href}>{block.action}</Link></li>)}</ul></div>}
          <p className="text-xs mb-4">Cupo restante hoy: US${(s.budget_date === b.today ? Math.max(0,s.budget_cents-b.spent)/100 : 0).toFixed(2)}. El panel no consulta el saldo de Twilio ni los créditos de ElevenLabs: comprobá ambos antes de autorizar.</p>
          <p className="text-sm mb-4">Para una nueva prueba a este mismo número, revisá el contexto y confirmá abajo. Cada intento necesita una nueva confirmación. Si el anterior sigue pendiente o incierto, primero actualizá su resultado.</p>
          <SalesForm intent="dial" label="Iniciar una llamada" disabled={!enabled}>
            <input type="hidden" name="id" value={id} /><input type="hidden" name="request_key" value={randomUUID()} />
            <label className="flex gap-2 text-sm"><input type="checkbox" name="confirm" required /> Revisé el contacto y autorizo una llamada grabada en Twilio ahora a {p.business_name}, {p.phone}.</label>
          </SalesForm>
        </Card>
        <Card><h2 className="font-display text-xl mb-3">Seguimiento de Axel</h2><p className="text-sm mb-3">{p.notes || "Sin próximo paso registrado."}</p><Link className="font-semibold underline" href={demoUrl} target="_blank">Abrir demo con su web</Link><p className="text-xs mt-2">El enlace abre la landing personalizada. Podés copiarlo y compartirlo manualmente si te lo solicitan.</p></Card>
        <Card><h2 className="font-display text-xl mb-3">No volver a llamar</h2><SalesForm intent="block" label="Registrar baja del número" disabled={p.suppressed}><input type="hidden" name="id" value={id} /></SalesForm></Card>
      </div>
    </div>
    <h2 className="font-display text-xl mb-4">Historial de llamadas</h2>
    {calls.length === 0 && <Empty>No hay llamadas a este consultorio.</Empty>}
    <div className="space-y-4">{calls.map((c) => <Card key={c.id}>
      <div className="flex flex-wrap justify-between gap-2"><p className="text-sm">{new Date(c.created_at).toLocaleString("es-AR",{ timeZone: "America/Argentina/Buenos_Aires", hour12: false })}</p><Badge>{c.status.replaceAll("_"," ")}</Badge></div>
      <p className="mt-3 text-sm">{c.config_version > 0 ? `Versión del agente: ${c.config_version}` : "Llamada anterior al editor"} · {c.outcome?.replaceAll("_"," ") || "Sin resultado comercial"}{c.duration_secs !== null ? ` · ${c.duration_secs} s` : ""}{c.credits !== null ? ` · ${c.credits} créditos ElevenLabs` : ""}</p>
      {c.summary && <p className="mt-2 text-sm">{c.summary}</p>}{c.error && <p role="alert" className="mt-2 text-sm text-red-700">{c.error}</p>}
      {(c.conversation_id || c.status === "incierta") && <div className="my-3"><SalesForm intent="refresh" label="Actualizar resultado"><input type="hidden" name="call_id" value={c.id} />{!c.conversation_id && <Field label="ID de conversación de ElevenLabs" hint="Solo el ID conv_… del intento revisado. Se valida que pertenezca a esta llamada; no pegues claves."><input className={inputClass} name="conversation_id" pattern="conv_[a-zA-Z0-9]+" required /></Field>}</SalesForm></div>}
      {c.transcript && <details className="mt-4"><summary className="cursor-pointer font-semibold text-sm">Ver transcripción</summary><ol className="mt-3 space-y-2">{c.transcript.map((t,i) => <li key={i} className="text-sm"><strong>{t.role === "agent" ? "Agente" : t.role === "user" ? "Consultorio" : "Sistema"}:</strong> {t.message || "[herramienta]"}</li>)}</ol></details>}
    </Card>)}</div>
  </>;
}
