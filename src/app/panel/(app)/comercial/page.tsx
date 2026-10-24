import Link from "next/link";
import { sql } from "@/lib/db";
import { requireAdmin } from "@/lib/panel-clinic";
import { budgetToday, salesSettings, type Prospect, type SalesCall } from "@/lib/sales/service";
import { FIRST_MESSAGE, listSalesVoices, type SalesVoice } from "@/lib/sales/agent";
import { Badge, Card, Field, inputClass, PageHeader, Stat, Empty, secondaryButtonClass } from "@/components/ui";
import { SalesForm } from "./form";
import { ReviewFields } from "./fields";

export const maxDuration = 300;

export default async function CommercialPage() {
  await requireAdmin();
  const [s, budget, prospects, active, voices] = await Promise.all([
    salesSettings(), budgetToday(),
    sql<Prospect[]>`select p.*, exists(select 1 from sales_suppressions b where b.phone = p.phone) as suppressed from sales_prospects p order by created_at desc limit 200`,
    sql<SalesCall[]>`select * from sales_calls where status in ('iniciando','en_curso','incierta') order by created_at desc`,
    listSalesVoices().catch(() => [] as SalesVoice[]),
  ]);
  const enabled = s.enabled && s.budget_date === budget.today;
  return <>
    <PageHeader title="Comercial · Sofi" description="La voz de Sofi, con un pitch de ventas: demo personalizada para consultorios odontológicos y después charla con Axel. Una llamada por vez, confirmada por vos." />
    <div className="grid gap-4 sm:grid-cols-3 mb-6">
      <Stat label="Piloto" value={enabled ? "Habilitado hoy" : "Pausado"} hint="No hay llamadas automáticas ni recargas." />
      <Stat label="Cupo autorizado hoy" value={`US$${(s.budget_date === budget.today ? s.budget_cents / 100 : 0).toFixed(2)}`} hint="Vence al terminar el día en Argentina." />
      <Stat label="Reservado por intentos" value={`US$${(budget.spent / 100).toFixed(2)}`} hint="Reserva preventiva: US$1 por intento. 60 s de conversación, más despedida." />
    </div>
    {active.length > 0 && <Card className="mb-6"><h2 className="font-semibold">Llamada pendiente</h2>{active.map((c) => <p key={c.id} className="mt-2"><Link className="underline" href={`/panel/comercial/${c.prospect_id}`}>{c.business_name}: {c.status.replaceAll("_"," ")}</Link></p>)}<p className="text-sm mt-2">No se habilita otro intento hasta revisar el resultado. Un inicio incierto requiere reconciliar con el proveedor.</p></Card>}
    <Card className="mb-6" id="como-llamar">
      <h2 className="font-display text-xl mb-4">Cómo disparar una prueba</h2>
      <div className="grid gap-5 sm:grid-cols-2 text-sm">
        <div><h3 className="font-semibold mb-2">Al mismo número</h3><p>Abrí su ficha en «Consultorios y pruebas», revisá el contacto y marcá la confirmación. «Iniciar una llamada» genera un intento. Para otra prueba, volvé a abrir la ficha y confirmá de nuevo.</p><a className="mt-2 inline-block underline" href="#contactos">Ver números guardados</a></div>
        <div><h3 className="font-semibold mb-2">A un número nuevo</h3><p>Agregá una ficha con nombre, teléfono internacional, web y contexto. Registrá el permiso o revisión del contacto, guardá y abrí la ficha para confirmar la llamada.</p><a className="mt-2 inline-block underline" href="#agregar-consultorio">Agregar un número nuevo</a></div>
      </div>
      <p className="mt-4 text-sm">Antes de llamar: comprobá el saldo compartido de Twilio y <a className="underline" href="#presupuesto">habilitá el cupo de hoy</a>. Guardar una ficha o cambiar la voz no inicia llamadas.</p>
    </Card>
    <div className="grid gap-6 xl:grid-cols-2 mb-6">
      <Card><h2 className="font-display text-xl mb-3">1. Preparar al agente</h2>
        <p className="text-sm mb-3">{s.agent_id ? `Agente comercial configurado. Voz: ${voices.find((v) => v.voice_id === s.voice_id)?.name || "guardada en ElevenLabs"}.` : "Todavía no está configurada. Podés usar la misma voz de Sofi."} Prepararlo no inicia llamadas.</p>
        <blockquote className="border-l-2 border-brand-300 pl-3 text-sm mb-4">{FIRST_MESSAGE.replace("{{business_name}}", "[nombre del consultorio]")}</blockquote>
        <p className="text-sm mb-4">Si hay interés, registra el pedido de demo para que vos hagas el seguimiento. Si piden no recibir llamadas, guarda la baja y termina. No ofrece precios.</p>
        <SalesForm intent="prepare_sofi" label="Usar la voz de Sofi y aplicar pitch" />
        <p className="text-xs text-brand-900/70 mt-2 mb-4">Lee la voz de la recepcionista principal y la aplica al agente comercial. La recepcionista conserva su configuración.</p>
        <details><summary className="cursor-pointer text-sm font-semibold mb-3">Elegir otra voz guardada</summary>
        <SalesForm intent="prepare" label="Aplicar voz y pitch, y pausar" disabled={voices.length === 0}>
          <Field label="Voz comercial" hint="Voces guardadas en tu cuenta. ElevenLabs no admite en agentes las que tienen moderación en vivo; aparecen deshabilitadas.">
            <select name="voice_id" required className={inputClass} defaultValue={s.voice_id || ""}>
              <option value="" disabled>Elegí una voz compatible</option>
              {voices.map((v) => <option key={v.voice_id} value={v.voice_id} disabled={v.live_moderated}>{v.name}{v.label ? ` · ${v.label}` : ""}{v.live_moderated ? " — No apta para agentes (moderación)" : ""}</option>)}
            </select>
          </Field>
          {voices.length === 0 && <p className="text-sm">No se pudo leer la lista de voces. Revisá ElevenLabs y recargá la página.</p>}
        </SalesForm>
        </details>
      </Card>
      <Card id="presupuesto"><h2 className="font-display text-xl mb-3">2. Autorizar el cupo de hoy</h2>
        <p className="text-sm mb-4">El panel reserva US$1 por intento. El límite es de 60 segundos de conversación más el tiempo de despedida: Twilio puede facturar dos minutos. Es una estimación preventiva, no un saldo ni una factura. Twilio y ElevenLabs cobran por separado y el saldo de Twilio se comparte con tus otros negocios. No habilites un cupo mayor al saldo disponible. Nunca se recarga desde acá.</p>
        <SalesForm intent="budget" label="Guardar cupo y estado">
          <Field label="Máximo autorizado hoy (US$)"><input name="budget" inputMode="decimal" className={inputClass} defaultValue={s.budget_date === budget.today ? (s.budget_cents / 100).toFixed(2) : "0.00"} required /></Field>
          <label className="flex gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked={enabled} /> Habilitar llamadas manuales hoy</label>
          <label className="flex gap-2 text-sm"><input type="checkbox" name="authorize" /> Autorizo ese gasto con saldo existente y revisé el saldo compartido. Sin recargas.</label>
        </SalesForm>
      </Card>
    </div>
    <Card className="mb-6" id="contactos"><h2 className="font-display text-xl mb-3">3. Consultorios y pruebas</h2>
      {prospects.length === 0 ? <Empty>Todavía no cargaste consultorios. Agregar una ficha no llama ni envía mensajes.</Empty> : <ul className="divide-y divide-brand-100">{prospects.map((p) => <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><Link className="font-semibold underline" href={`/panel/comercial/${p.id}`}>{p.business_name}</Link><p className="text-sm">{p.phone}</p></div><div className="flex flex-wrap items-center gap-3"><Badge tone={p.suppressed ? "red" : p.outcome === "interesado" ? "green" : "gray"}>{p.suppressed ? "No llamar" : p.outcome?.replaceAll("_"," ") || (p.eligibility === "sin_revisar" ? "Sin revisar" : "Revisado")}</Badge><Link className={secondaryButtonClass} href={`/panel/comercial/${p.id}`}>Abrir ficha y llamar</Link></div></li>)}</ul>}
    </Card>
    <Card id="agregar-consultorio"><h2 className="font-display text-xl mb-4">Agregar consultorio o número de prueba</h2>
      <SalesForm intent="prospect" label="Guardar consultorio">
        <div className="grid gap-4 sm:grid-cols-2"><Field label="Nombre del consultorio"><input name="business_name" className={inputClass} minLength={3} maxLength={160} required /></Field><Field label="Teléfono internacional" hint="Ejemplo de formato: +54 9 11 1234 5678"><input name="phone" type="tel" className={inputClass} required /></Field></div>
        <Field label="Web pública"><input name="website" type="url" placeholder="https://" className={inputClass} maxLength={500} required /></Field>
        <ReviewFields />
      </SalesForm>
    </Card>
  </>;
}
