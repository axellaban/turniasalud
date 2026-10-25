import Link from "next/link";
import { sql } from "@/lib/db";
import { requireAdmin } from "@/lib/panel-clinic";
import { budgetToday, salesSettings, type Prospect, type SalesCall } from "@/lib/sales/service";
import { Badge, Card, Field, inputClass, PageHeader, Empty, Notice, secondaryButtonClass } from "@/components/ui";
import { SalesForm } from "./form";
import { ReviewFields } from "./fields";
import { BudgetControl, PendingCalls } from "./call-controls";

export const maxDuration = 300;

export default async function CommercialPage() {
  await requireAdmin();
  const [s, budget, prospects, active] = await Promise.all([
    salesSettings(), budgetToday(),
    sql<Prospect[]>`select p.*, exists(select 1 from sales_suppressions b where b.phone = p.phone) as suppressed from sales_prospects p order by created_at desc limit 200`,
    sql<SalesCall[]>`select * from sales_calls where status in ('iniciando','en_curso','incierta') order by created_at desc`,
  ]);
  return <>
    <PageHeader title="Llamadas comerciales · Sofi" description="Elegí un contacto, abrí su ficha y confirmá la llamada. El guion de Sofi ya está guardado; no tenés que cargarlo de nuevo." actions={<a href="#agregar-consultorio" className={secondaryButtonClass}>Agregar otro número</a>} />
    {s.needs_sync && <Notice tone="error">La última configuración no se pudo comprobar. <Link href="/panel/comercial/configuracion" className="underline">Guardá y aplicá de nuevo el guion de Sofi</Link>.</Notice>}
    <div className="space-y-6">
      <PendingCalls calls={active} />
      <Card id="contactos"><h2 className="font-display text-xl mb-2">¿A quién querés llamar?</h2>
        <p className="text-sm mb-4">Para repetir una prueba usá la misma ficha. El contexto del consultorio se guarda allí una sola vez y podés editarlo cuando quieras.</p>
        {prospects.length === 0 ? <Empty>Agregá tu primer contacto abajo. Guardar una ficha no inicia llamadas.</Empty> : <ul className="divide-y divide-brand-100">{prospects.map(p => <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-4"><div className="min-w-0"><Link className="font-semibold underline break-words" href={`/panel/comercial/${p.id}`}>{p.business_name}</Link><p className="text-sm">{p.phone}</p></div><div className="flex flex-wrap items-center gap-3"><Badge tone={p.suppressed ? "red" : "gray"}>{p.suppressed ? "No llamar" : p.eligibility === "sin_revisar" ? "Falta revisar contacto" : "Contacto revisado"}</Badge><Link className={secondaryButtonClass} href={`/panel/comercial/${p.id}`}>Preparar llamada</Link></div></li>)}</ul>}
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <BudgetControl settings={s} budget={budget} />
        <Card><h2 className="font-display text-xl mb-3">Guion general de Sofi</h2><p className="text-sm mb-4">El saludo, las instrucciones y la voz se usan en todas las llamadas comerciales. {s.applied_at ? `Versión ${s.config_version} aplicada.` : "Falta aplicar la configuración."} Los datos de cada consultorio se agregan desde su ficha.</p><Link className={secondaryButtonClass} href="/panel/comercial/configuracion">Editar saludo, instrucciones y voz</Link><p className="mt-4 text-xs text-brand-900/70">Aplicar cambios pausa las llamadas para que revises el cupo antes de continuar.</p></Card>
      </div>
      <Card id="agregar-consultorio" className="scroll-mt-24"><details open={prospects.length === 0}><summary className="cursor-pointer font-display text-xl">Agregar otro número o consultorio</summary><p className="my-4 text-sm">Completá estos datos solo para un destinatario nuevo. Para el mismo número, volvé a su ficha guardada.</p>
        <SalesForm intent="prospect" label="Guardar contacto">
          <div className="grid gap-4 sm:grid-cols-2"><Field label="Nombre de la clínica que dirá Sofi"><input name="business_name" className={inputClass} minLength={3} maxLength={160} required /></Field><Field label="Teléfono internacional" hint="Ejemplo: +54 9 11 1234 5678"><input name="phone" type="tel" autoComplete="tel" className={inputClass} required /></Field></div>
          <Field label="Web pública"><input name="website" type="url" placeholder="https://…" className={inputClass} maxLength={500} required /></Field><ReviewFields />
        </SalesForm>
      </details></Card>
    </div>
  </>;
}
