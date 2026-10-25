import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { isUuid } from "@/lib/clinic";
import { requireAdmin } from "@/lib/panel-clinic";
import { budgetToday, salesSettings, type Prospect, type SalesCall } from "@/lib/sales/service";
import { salesConfiguration } from "@/lib/sales/config";
import { salesCallBlockers } from "@/lib/sales/availability";
import { Badge, Card, PageHeader, Empty, Notice, Field, inputClass } from "@/components/ui";
import { SalesForm } from "../form";
import { ReviewFields } from "../fields";
import { BudgetControl, PendingCalls } from "../call-controls";

export const maxDuration = 60;

export default async function SalesProspectPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [p] = await sql<Prospect[]>`select p.*, exists(select 1 from sales_suppressions b where b.phone = p.phone) as suppressed from sales_prospects p where id = ${id}`;
  if (!p) notFound();
  const [s,b,calls,pending] = await Promise.all([salesSettings(),budgetToday(),sql<SalesCall[]>`select * from sales_calls where prospect_id = ${id} order by created_at desc limit 50`,sql<SalesCall[]>`select * from sales_calls where status in ('iniciando','en_curso','incierta') limit 1`]);
  const blockers = salesCallBlockers(s,b,pending.length>0,!!process.env.ELEVENLABS_PHONE_NUMBER_ID,p);
  const enabled = blockers.length === 0;
  const needsReview = blockers.some(block => block.href === "#contacto") && !p.suppressed;
  const demoUrl = `/probar-demo?web=${encodeURIComponent(p.website)}`;
  return <>
    <PageHeader title={p.business_name} description={p.phone} actions={<Link className="underline" href="/panel/comercial">Volver a Comercial</Link>} />
    {p.suppressed && <Notice tone="warning">Este número está dado de baja. No se permiten nuevas llamadas, tampoco desde una ficha duplicada.</Notice>}
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] my-6">
      <div className="space-y-6 min-w-0">
        <PendingCalls calls={pending} />
        <Card id="llamar" className="scroll-mt-24">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-display text-xl">{enabled ? "Todo listo para llamar" : "Preparar esta llamada"}</h2><Badge tone={enabled ? "green" : "yellow"}>{enabled ? "Habilitada" : "Falta un paso"}</Badge></div>
          <p className="mt-4 text-sm">Sofi llamará a <strong>{p.business_name}</strong></p><p className="my-2 font-display text-2xl break-all">{p.phone}</p>
          <p className="text-sm mb-4">Usará el guion general guardado (versión {s.config_version}) y los datos de este consultorio. No necesitás volver a escribir el contexto para repetir la prueba.</p>
          {!enabled && <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4"><h3 className="font-semibold text-sm">Resolvé lo siguiente</h3><ul className="mt-2 space-y-3">{blockers.map(block=><li key={block.message} className="text-sm"><p>{block.message}</p><Link className="underline font-semibold" href={block.href}>{block.action}</Link></li>)}</ul></div>}
          {enabled && <p className="text-sm mb-4 font-semibold text-brand-700">Confirmá el destinatario y tocá «Llamar ahora». Solo inicia una llamada.</p>}
          <SalesForm intent="dial" label="Llamar ahora" disabled={!enabled}>
            <input type="hidden" name="id" value={id} /><input type="hidden" name="request_key" value={randomUUID()} />
            <label className="flex gap-3 rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm"><input type="checkbox" name="confirm" required /> Autorizo una llamada grabada ahora a {p.phone}, con el cupo de hoy.</label>
          </SalesForm>
          <p className="mt-4 text-xs text-brand-900/70">Máximo de 60 segundos de conversación, más despedida. Reserva de US$1 por intento, sin reintentos automáticos. La grabación y el almacenamiento de Twilio tienen cargo por uso.</p>
          <a href="https://www.twilio.com/console/voice/recordings/recording-logs?x-target-region=us1&__override_layout__=embed" target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-sm underline">Ver grabaciones en Twilio</a>
        </Card>
        <BudgetControl settings={s} budget={b} />
      </div>
      <div className="space-y-6 min-w-0">
        <Card id="contacto" className="scroll-mt-24"><h2 className="font-display text-xl mb-3">Datos de este consultorio</h2>
          <p className="text-sm mb-3"><strong>Nombre que dirá Sofi:</strong> {p.business_name}</p><p className="text-xs mb-3 text-brand-900/70">Se usa el nombre de esta ficha comercial. El selector de clínica del encabezado no cambia el destinatario de la llamada.</p><p className="text-sm break-all">{p.website}</p>
          <p className="mt-3 text-sm whitespace-pre-wrap break-words">{p.context || "Sin datos adicionales. Sofi usará el nombre del consultorio y su guion general."}</p>
          <p className="mt-3 text-xs text-brand-900/70">{needsReview ? "La revisión del contacto necesita actualizarse." : p.suppressed ? "Este número está bloqueado." : "Contacto revisado. Podés llamar sin volver a guardar estos datos mientras la revisión siga vigente."}</p>
          <details className="mt-4" open={needsReview}><summary className="cursor-pointer font-semibold text-sm">Editar datos y revisión del contacto</summary><div className="mt-4"><SalesForm intent="review" label="Guardar datos de este contacto"><input type="hidden" name="id" value={id} /><Field label="Nombre de la clínica que dirá Sofi" hint="Usá el nombre real del consultorio. No pongas un alias como «prueba de Axel», porque Sofi lo pronunciará."><input name="business_name" className={inputClass} minLength={3} maxLength={160} defaultValue={p.business_name} required /></Field><ReviewFields eligibility={p.eligibility} evidence={p.evidence} context={p.context} /></SalesForm></div></details>
        </Card>
        <Card><h2 className="font-display text-xl mb-3">Qué va a decir Sofi</h2><p className="text-sm mb-3">Así empezará la llamada con el nombre guardado en esta ficha:</p><blockquote className="border-l-2 border-brand-300 pl-3 mb-4 text-sm whitespace-pre-wrap break-words">{salesConfiguration(s).first_message.replaceAll("{{business_name}}", p.business_name)}</blockquote><p className="text-xs mb-3 text-brand-900/70">El saludo y las instrucciones generales se comparten entre todas las llamadas comerciales.</p><Link className="font-semibold underline text-sm" href="/panel/comercial/configuracion">Ver o editar el guion general de Sofi</Link></Card>
        <Card><details><summary className="cursor-pointer font-semibold">Seguimiento y opciones del contacto</summary><p className="my-3 text-sm">{p.notes || "Sin próximo paso registrado."}</p><Link className="font-semibold underline text-sm" href={demoUrl} target="_blank">Abrir demo con su web</Link><p className="text-xs mt-2 mb-5">Podés compartirla manualmente si te la solicitan.</p><SalesForm intent="block" label="Registrar baja: no volver a llamar" disabled={p.suppressed}><input type="hidden" name="id" value={id} /></SalesForm></details></Card>
      </div>
    </div>
    <h2 className="font-display text-xl mb-4">Historial de llamadas</h2>
    {calls.length === 0 && <Empty>No hay llamadas a este consultorio.</Empty>}
    <div className="space-y-4">{calls.map((c) => <Card key={c.id}>
      <div className="flex flex-wrap justify-between gap-2"><p className="text-sm">{new Date(c.created_at).toLocaleString("es-AR",{ timeZone: "America/Argentina/Buenos_Aires", hour12: false })}</p><Badge>{c.status.replaceAll("_"," ")}</Badge></div>
      <p className="mt-3 text-sm">{c.config_version > 0 ? `Versión del agente: ${c.config_version}` : "Llamada anterior al editor"} · {c.outcome?.replaceAll("_"," ") || "Sin resultado comercial"}{c.duration_secs !== null ? ` · ${c.duration_secs} s` : ""}{c.credits !== null ? ` · ${c.credits} créditos ElevenLabs` : ""}</p>
      {c.summary && <p className="mt-2 text-sm">{c.summary}</p>}{c.error && <p role="alert" className="mt-2 text-sm text-red-700">{c.error}</p>}
      {(c.conversation_id || c.status === "incierta") && !["iniciando", "en_curso", "incierta"].includes(c.status) && <div className="my-3"><SalesForm intent="refresh" label="Actualizar resultado"><input type="hidden" name="call_id" value={c.id} />{!c.conversation_id && <Field label="ID de conversación de ElevenLabs" hint="Solo el ID conv_… del intento revisado. Se valida que pertenezca a esta llamada; no pegues claves."><input className={inputClass} name="conversation_id" pattern="conv_[a-zA-Z0-9]+" required /></Field>}</SalesForm></div>}
      {c.transcript && <details className="mt-4"><summary className="cursor-pointer font-semibold text-sm">Ver transcripción</summary><ol className="mt-3 space-y-2">{c.transcript.map((t,i) => <li key={i} className="text-sm"><strong>{t.role === "agent" ? "Agente" : t.role === "user" ? "Consultorio" : "Sistema"}:</strong> {t.message || "[herramienta]"}</li>)}</ol></details>}
    </Card>)}</div>
  </>;
}
