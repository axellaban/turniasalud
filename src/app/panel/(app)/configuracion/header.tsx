import Link from "next/link";
import { Notice, PageHeader, Tabs } from "@/components/ui";
import { sql } from "@/lib/db";
import { configConflicts, type ConfigConflict } from "@/lib/config-conflicts";
import { getCatalog } from "@/lib/clinic";
import { getSmileApiConnection, smileIsSource, SMILE_MODE_LABEL, type SmileMode } from "@/lib/smile-connect-link";
import { LockIcon } from "./smile-lock";
import type { Clinic } from "@/lib/types";

// En el orden en que se arma un consultorio: quién es, quién atiende y cuándo, qué se da, con qué
// cobertura, las reglas de los turnos y, al final, los días sin atención y las integraciones (Google Calendar y Smile Connect).
const TABS = [
  { href: "/panel/configuracion", label: "Consultorio" },
  { href: "/panel/configuracion/equipo", label: "Equipo y horarios" },
  { href: "/panel/configuracion/prestaciones", label: "Prestaciones" },
  { href: "/panel/configuracion/coberturas", label: "Coberturas" },
  { href: "/panel/configuracion/turnos", label: "Turnos y urgencias" },
  { href: "/panel/configuracion/bloqueos", label: "Feriados y bloqueos" },
  { href: "/panel/configuracion/calendario", label: "Agenda e integraciones" },
];

export const WEEKDAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

/**
 * El mismo dato escrito en dos lugares que no dicen lo mismo (condiciones contra reglas, precios,
 * formas de pago). Lo cargan las pestañas donde viven esos datos y se avisa arriba.
 */
export async function loadConfigConflicts(clinic: Clinic): Promise<ConfigConflict[]> {
  const [prices, catalog] = await Promise.all([
    sql<{ price: number }[]>`
      select distinct price::int as price from appointment_types where clinic_id = ${clinic.id} and active and price is not null`,
    getCatalog(clinic.id),
  ]);
  return configConflicts(clinic, prices.map((r) => r.price), {
    schedules: catalog.schedules,
    professionals: new Map(catalog.professionals.map((p) => [p.id, p.full_name])),
  });
}

function ConflictList({ items, action = "Corregir →" }: { items: ConfigConflict[]; action?: string }) {
  return <ul className="mt-1 space-y-1">
    {items.map((c) => (
      <li key={c.key}>
        {c.message} <Link href={c.href} className="font-semibold text-brand-700 hover:underline">{action}</Link>
      </li>
    ))}
  </ul>;
}

/** Pestañas cuyo contenido, con Smile Connect como fuente, viene (en todo o en parte) de allá. */
const FROM_SMILE = new Set(["/panel/configuracion/equipo", "/panel/configuracion/bloqueos", "/panel/configuracion/calendario"]);

/**
 * Regla para toda clínica con Smile Connect conectado (cualquier modo menos «Apagada»): Smile Connect
 * es la fuente de la verdad de la agenda. Se dice arriba de cada pestaña, las pestañas que traen datos
 * de allá llevan la etiqueta y lo que no se puede cambiar acá aparece con candado.
 */
/** El modo de Smile Connect si es la fuente de la verdad de la clínica; null si no está conectado. */
export async function loadSmileSource(clinicId: string): Promise<SmileMode | null> {
  const smile = await getSmileApiConnection(clinicId).catch(() => null);
  return smileIsSource(smile) ? smile!.api_mode : null;
}

export function ConfigHeader({ clinic, current, conflicts = [], smileMode = null }: { clinic: Clinic; current: string; conflicts?: ConfigConflict[]; smileMode?: SmileMode | null }) {
  const warnings = conflicts.filter((c) => c.tone !== "info");
  const infos = conflicts.filter((c) => c.tone === "info");
  const fromSmile = smileMode !== null;
  const agent = clinic.agent_name || "Sofi";
  const tabs = fromSmile ? TABS.map((t) => (FROM_SMILE.has(t.href) ? { ...t, tag: "Smile", tagTitle: "Viene de Smile Connect" } : t)) : TABS;
  return <>
    <PageHeader title="Configuración" description={`${clinic.name}. Lo que cambies acá lo usa ${agent} desde el próximo mensaje.`} />
    {fromSmile && (
      <div className="mb-4 flex gap-3 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-950">
        <LockIcon className="mt-0.5 h-5 w-5 shrink-0 text-violet-700" />
        <div>
          <p className="font-semibold">
            Conectado a Smile Connect: la agenda se maneja allá
            <span className="ml-2 rounded-full bg-white px-2 py-0.5 text-xs font-medium text-violet-800 ring-1 ring-violet-200">{SMILE_MODE_LABEL[smileMode!].label}</span>
          </p>
          <p className="mt-1 text-violet-900/80">
            <strong>Los profesionales, sus horarios, los bloqueos, los feriados, los turnos y los pacientes</strong> se cambian en Smile Connect y llegan solos. Acá aparecen con <LockIcon className="inline h-3.5 w-3.5 align-[-2px]" />.
            {" "}<strong>Acá se configura cómo atiende {agent}:</strong> prestaciones, coberturas, reglas de turnos, urgencias y lo que responde.
          </p>
        </div>
      </div>
    )}
    <Tabs items={tabs} current={current} />
    {warnings.length > 0 && (
      <Notice tone="warning" className="mb-6">
        <p className="font-semibold">{warnings.length === 1 ? "Hay un dato que se contradice" : `Hay ${warnings.length} datos que se contradicen`}</p>
        <ConflictList items={warnings} />
      </Notice>
    )}
    {infos.length > 0 && (
      <Notice tone="info" className="mb-6">
        <ConflictList items={infos} action="Cambiar →" />
      </Notice>
    )}
  </>;
}
