import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { isUuid } from "@/lib/clinic";
import { requireAdmin } from "@/lib/panel-clinic";
import { budgetToday, salesSettings, type Prospect, type SalesCall } from "@/lib/sales/service";
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
  const [s,b,calls] = await Promise.all([salesSettings(),budgetToday(),sql<SalesCall[]>`select * from sales_calls where prospect_id = ${id} order by created_at desc limit 50`]);
  const enabled = s.enabled && s.budget_date === b.today && s.budget_cents - b.spent >= 100 && !!s.agent_id && !p.suppressed;
  const demoUrl = `/probar-demo?web=${encodeURIComponent(p.website)}`;
  return <>
    <PageHeader title={p.business_name} description={p.phone} actions={<Link className="underline" href="/panel/comercial">Volver a Comercial</Link>} />
    {p.suppressed && <Notice tone="warning">Este número está dado de baja. No se permiten nuevas llamadas, tampoco desde una ficha duplicada.</Notice>}
    <div className="grid gap-6 xl:grid-cols-2 my-6">
      <Card><h2 className="font-display text-xl mb-4">Contexto y contacto</h2><p className="mb-4 text-sm break-all">{p.website}</p>
        <SalesForm intent="review" label="Guardar contexto y revisión"><input type="hidden" name="id" value={id} /><ReviewFields eligibility={p.eligibility} evidence={p.evidence} context={p.context} /></SalesForm>
      </Card>
      <div className="space-y-6">
        <Card><h2 className="font-display text-xl mb-3">Llamada manual</h2><p className="text-sm mb-4">Destino: <strong>{p.phone}</strong>. Agustín ofrece una demo personalizada y charla con Axel. Máximo 60 segundos; reserva de US$1. No se envían mensajes ni se reintenta automáticamente.</p>
          {!enabled && <p className="text-sm mb-3">Llamadas bloqueadas: revisá la preparación, el cupo de hoy y las bajas en Comercial.</p>}
          <SalesForm intent="dial" label="Iniciar una llamada" disabled={!enabled}>
            <input type="hidden" name="id" value={id} /><input type="hidden" name="request_key" value={randomUUID()} />
            <label className="flex gap-2 text-sm"><input type="checkbox" name="confirm" required /> Revisé el contacto y autorizo una llamada ahora a {p.business_name}, {p.phone}.</label>
          </SalesForm>
        </Card>
        <Card><h2 className="font-display text-xl mb-3">Seguimiento de Axel</h2><p className="text-sm mb-3">{p.notes || "Sin próximo paso registrado."}</p><Link className="font-semibold underline" href={demoUrl} target="_blank">Abrir demo con su web</Link><p className="text-xs mt-2">El enlace abre la landing personalizada. Podés copiarlo y compartirlo manualmente si te lo solicitan.</p></Card>
        <Card><h2 className="font-display text-xl mb-3">No volver a llamar</h2><SalesForm intent="block" label="Registrar baja del número" disabled={p.suppressed}><input type="hidden" name="id" value={id} /></SalesForm></Card>
      </div>
    </div>
    <h2 className="font-display text-xl mb-4">Historial de llamadas</h2>
    {calls.length === 0 && <Empty>No hay llamadas a este consultorio.</Empty>}
    <div className="space-y-4">{calls.map((c) => <Card key={c.id}>
      <div className="flex flex-wrap justify-between gap-2"><p className="text-sm">{new Date(c.created_at).toLocaleString("es-AR",{ timeZone: "America/Argentina/Buenos_Aires" })}</p><Badge>{c.status.replaceAll("_"," ")}</Badge></div>
      <p className="mt-3 text-sm">{c.outcome?.replaceAll("_"," ") || "Sin resultado comercial"}{c.duration_secs !== null ? ` · ${c.duration_secs} s` : ""}{c.credits !== null ? ` · ${c.credits} créditos ElevenLabs` : ""}</p>
      {c.summary && <p className="mt-2 text-sm">{c.summary}</p>}{c.error && <p role="alert" className="mt-2 text-sm text-red-700">{c.error}</p>}
      {(c.conversation_id || c.status === "incierta") && <div className="my-3"><SalesForm intent="refresh" label="Actualizar resultado"><input type="hidden" name="call_id" value={c.id} />{!c.conversation_id && <Field label="ID de conversación de ElevenLabs" hint="Solo el ID conv_… del intento revisado. Se valida que pertenezca a esta llamada; no pegues claves."><input className={inputClass} name="conversation_id" pattern="conv_[a-zA-Z0-9]+" required /></Field>}</SalesForm></div>}
      {c.transcript && <details className="mt-4"><summary className="cursor-pointer font-semibold text-sm">Ver transcripción</summary><ol className="mt-3 space-y-2">{c.transcript.map((t,i) => <li key={i} className="text-sm"><strong>{t.role === "agent" ? "Agustín" : t.role === "user" ? "Consultorio" : "Sistema"}:</strong> {t.message || "[herramienta]"}</li>)}</ol></details>}
    </Card>)}</div>
  </>;
}
