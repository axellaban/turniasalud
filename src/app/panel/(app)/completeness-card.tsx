import Link from "next/link";
import { Card } from "@/components/ui";
import { PanelIcon } from "@/components/panel-icons";
import type { CompletenessItem } from "@/lib/profile-completeness";

/** Cuánto de la ficha está completo y qué falta, con un enlace a cada dato. */
export function CompletenessCard({ percent, items, compact = false }: { percent: number; items: CompletenessItem[]; compact?: boolean }) {
  const missing = items.filter((i) => !i.done);
  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold text-brand-950">{percent === 100 ? "Ficha completa" : `Ficha completa al ${percent} %`}</h2>
        <span className="text-sm font-semibold text-brand-700">{items.length - missing.length}/{items.length}</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-brand-50" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Ficha completa">
        <div className={`h-full rounded-full ${percent === 100 ? "bg-emerald" : "bg-brand-600"}`} style={{ width: `${percent}%` }} />
      </div>
      {missing.length > 0 ? <>
        <p className="mt-3 text-sm text-brand-900/60">Completá esto para que el agente no tenga que decir «no tengo esa información»:</p>
        <ul className={`mt-2 grid gap-1 text-sm ${compact ? "" : "sm:grid-cols-2"}`}>
          {missing.map((item) => <li key={item.label}>
            <Link href={item.href} className="flex items-center gap-2 rounded-lg px-2 py-1 text-brand-800 hover:bg-brand-50">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sun-500" aria-hidden />{item.label}<PanelIcon name="derecha" className="ml-auto h-4 w-4 text-brand-900/30" />
            </Link>
          </li>)}
        </ul>
      </> : <p className="mt-3 text-sm text-brand-900/60">Tiene todo lo que el agente necesita. Revisala cuando cambie algo de la atención.</p>}
    </Card>
  );
}
