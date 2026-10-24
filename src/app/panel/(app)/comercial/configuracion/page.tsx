import Link from "next/link";
import { requireAdmin } from "@/lib/panel-clinic";
import { sql } from "@/lib/db";
import { salesSettings } from "@/lib/sales/service";
import { listSalesVoices } from "@/lib/sales/agent";
import { salesConfiguration } from "@/lib/sales/config";
import { Card, PageHeader, Notice } from "@/components/ui";
import { SalesConfigEditor } from "./editor";

export const maxDuration = 300;
export default async function SalesConfigurationPage() {
  await requireAdmin();
  const [s, voices, history, pending] = await Promise.all([
    salesSettings(), listSalesVoices().catch(()=>[]),
    sql<{version:number;first_message:string;source:string;created_at:string}[]>`select version,first_message,source,created_at from sales_config_versions order by version desc limit 10`,
    sql`select id from sales_calls where status in ('iniciando','en_curso','incierta') limit 1`,
  ]);
  return <>
    <PageHeader title="Configuración de Sofi comercial" description="Editá el saludo, las instrucciones y la voz. Esta configuración es solo para ventas; la recepcionista clínica conserva la suya." actions={<Link href="/panel/comercial" className="underline">Volver a Comercial</Link>} />
    {s.needs_sync && <Notice tone="error">La última aplicación no se pudo comprobar. El piloto sigue pausado. Revisá el formulario y volvé a guardar y aplicar; la versión anterior sigue conservada.</Notice>}
    {pending.length>0 && <Notice tone="warning">Hay una llamada pendiente. Podés revisar el texto, pero primero actualizá su resultado para aplicar cambios.</Notice>}
    {voices.length===0 && <Notice tone="warning">No se pudo leer la lista de voces. Podés conservar la actual; la disponibilidad se comprueba al aplicar.</Notice>}
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px] mt-6">
      <Card><SalesConfigEditor initial={{...salesConfiguration(s),voice_id:s.voice_id || "sofi",version:s.config_version}} voices={voices} hasPrevious={history.some(h=>h.version<s.config_version)} /></Card>
      <aside className="space-y-6">
        <Card><h2 className="font-display text-xl mb-3">Versión guardada</h2><p className="font-semibold">{s.applied_at ? `Versión ${s.config_version}` : "Configuración inicial"}</p><p className="mt-2 text-sm">{s.applied_at ? `Última comprobación en ElevenLabs: ${new Date(s.applied_at).toLocaleString("es-AR",{timeZone:"America/Argentina/Buenos_Aires"})}.` : "Guardá y aplicá para registrar la primera versión desde el panel."}</p><p className="mt-3 text-sm">Los cambios entran en vigor en las próximas llamadas. Guardar no llama ni modifica el cupo.</p></Card>
        <Card><h2 className="font-display text-xl mb-3">Historial</h2>{history.length===0 ? <p className="text-sm">La versión anterior se conserva al guardar por primera vez.</p> : <ol className="space-y-4">{history.map(h=><li key={h.version} className="text-sm border-b border-brand-900/10 pb-3 last:border-0"><strong>Versión {h.version}{h.version===s.config_version ? " · actual" : ""}</strong><p className="text-xs mt-1">{new Date(h.created_at).toLocaleString("es-AR",{timeZone:"America/Argentina/Buenos_Aires"})}{h.source==="restauracion" ? " · restauración" : ""}</p><p className="mt-2 line-clamp-3">{h.first_message}</p></li>)}</ol>}</Card>
      </aside>
    </div>
  </>;
}
