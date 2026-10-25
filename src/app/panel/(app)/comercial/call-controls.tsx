import Link from "next/link";
import { Badge, Card, Field, inputClass } from "@/components/ui";
import type { SalesCall, SalesSettings } from "@/lib/sales/service";
import { SalesForm } from "./form";

export function BudgetControl({ settings: s, budget: b }: { settings: SalesSettings; budget: { today: string; spent: number } }) {
  const enabled = s.enabled && s.budget_date === b.today;
  const remaining = s.budget_date === b.today ? Math.max(0, s.budget_cents - b.spent) / 100 : 0;
  return <Card id="presupuesto" className="scroll-mt-24">
    <div className="flex flex-wrap justify-between gap-2"><h2 className="font-display text-xl">Cupo de hoy</h2><Badge tone={enabled ? "green" : "yellow"}>{enabled ? "Habilitado" : "Falta habilitar"}</Badge></div>
    <p className="mt-3 text-sm">{enabled ? `US$${remaining.toFixed(2)} disponibles de US$${(s.budget_cents / 100).toFixed(2)} autorizados. No necesitás volver a habilitarlo para cada llamada.` : "Habilitá las llamadas y guardá el cupo una vez al día. No inicia ninguna llamada."}</p>
    <details className="mt-4" open={!enabled}>
      <summary className="cursor-pointer font-semibold text-sm">{enabled ? "Cambiar cupo o pausar llamadas" : "Habilitar llamadas manuales hoy"}</summary>
      <div className="mt-4"><SalesForm intent="budget" label="Guardar cupo y estado">
        <Field label="Máximo autorizado hoy (US$)"><input name="budget" inputMode="decimal" className={inputClass} defaultValue={s.budget_date === b.today ? (s.budget_cents / 100).toFixed(2) : "5.00"} required /></Field>
        <label className="flex gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked={enabled} /> Habilitar llamadas manuales hoy</label>
        <label className="flex gap-2 text-sm"><input type="checkbox" name="authorize" /> Revisé el saldo compartido y autorizo este gasto con saldo existente, sin recargas.</label>
      </SalesForm></div>
    </details>
    <p className="mt-4 text-xs text-brand-900/70">Reserva preventiva de US$1 por intento, también si no atienden. Vence a medianoche en Argentina. El panel no consulta saldos ni créditos: Twilio y ElevenLabs facturan por separado y el saldo de Twilio es compartido con tus otros negocios.</p>
  </Card>;
}

export function PendingCalls({ calls }: { calls: SalesCall[] }) {
  if (!calls.length) return null;
  return <Card id="pendiente" className="border-amber-200 bg-amber-50 scroll-mt-24">
    <h2 className="font-display text-xl">Comprobar la llamada anterior</h2>
    <p className="mt-2 text-sm">El proveedor todavía no confirmó el cierre en el panel. Comprobá el resultado para habilitar otro intento. Este botón consulta el estado; no vuelve a llamar.</p>
    {calls.map(c => <div className="mt-4 border-t border-amber-200 pt-4" key={c.id}>
      <p className="font-semibold text-sm"><Link className="underline" href={`/panel/comercial/${c.prospect_id}`}>{c.business_name}</Link> · {c.phone}</p>
      <p className="my-2 text-xs">{new Date(c.created_at).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour12: false })} · {c.status.replaceAll("_", " ")}</p>
      {(c.conversation_id || c.status === "incierta") ? <SalesForm intent="refresh" label="Comprobar si ya terminó"><input type="hidden" name="call_id" value={c.id} />{!c.conversation_id && <Field label="ID de conversación de ElevenLabs" hint="Copiá solo el ID conv_… de este intento. No pegues claves."><input className={inputClass} name="conversation_id" pattern="conv_[a-zA-Z0-9]+" required /></Field>}</SalesForm> : <p className="text-sm">El inicio todavía se está procesando. Volvé a abrir esta ficha para consultar el resultado.</p>}
    </div>)}
  </Card>;
}
