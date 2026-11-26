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

/** El modo de Smile Connect si es la fuente de la verdad de la clínica; null si no está conectado. */
export async function loadSmileSource(clinicId: string): Promise<SmileMode | null> {
  const smile = await getSmileApiConnection(clinicId).catch(() => null);
  return smileIsSource(smile) ? smile!.api_mode : null;
}

/** La pestaña donde se corrige cada aviso (y las que también lo muestran entero). */
const pathOf = (href: string) => href.split("#")[0];
const showsHere = (c: ConfigConflict, current: string) => pathOf(c.href) === current || (c.alsoOn ?? []).includes(current);

/**
 * Regla para toda clínica con Smile Connect conectado (cualquier modo menos «Apagada»): Smile Connect
 * es la fuente de la verdad de la agenda. En las pestañas que traen datos de allá se explica entero; en
 * las demás, en una línea. Las que traen datos de allá llevan un candado y lo que no se puede cambiar
 * acá aparece con candado. Los avisos de datos que se contradicen se muestran enteros en la pestaña donde
 * se corrigen; en las demás, una línea plegada con el total.
 */
export function ConfigHeader({ clinic, current, conflicts = [], smileMode = null }: { clinic: Clinic; current: string; conflicts?: ConfigConflict[]; smileMode?: SmileMode | null }) {
  const here = conflicts.filter((c) => showsHere(c, current));
  const elsewhere = conflicts.filter((c) => !showsHere(c, current));
  const warnings = here.filter((c) => c.tone !== "info");
  const infos = here.filter((c) => c.tone === "info");
  const fromSmile = smileMode !== null;
  const smileTab = FROM_SMILE.has(current);
  const agent = clinic.agent_name || "Sofi";
  const tabs = fromSmile ? TABS.map((t) => (FROM_SMILE.has(t.href) ? { ...t, icon: <LockIcon className="h-3 w-3 text-violet-600" />, iconTitle: "Viene de Smile Connect" } : t)) : TABS;
  return <>
    <PageHeader title="Configuración" description={`${clinic.name}. Lo que cambies acá lo usa ${agent} desde el próximo mensaje.`} />
    {fromSmile && (smileTab ? (
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
    ) : (
      <p className="mb-3 flex items-center gap-2 rounded-xl bg-violet-50 px-3 py-1.5 text-xs text-violet-900">
        <LockIcon className="h-3.5 w-3.5 shrink-0 text-violet-700" />
        <span><strong>Conectado a Smile Connect</strong> ({SMILE_MODE_LABEL[smileMode!].label}): la agenda se maneja allá. Esta pestaña es de {agent} y se configura acá.</span>
      </p>
    ))}
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
    {elsewhere.length > 0 && (
      <details className="mb-6 rounded-xl border border-brand-900/10 bg-white px-3 py-1.5 text-sm">
        <summary className="cursor-pointer text-brand-900/70">
          {elsewhere.length === 1 ? "1 cosa para revisar en otra pestaña" : `${elsewhere.length} cosas para revisar en otras pestañas`}
        </summary>
        <ConflictList items={elsewhere} action="Ir →" />
      </details>
    )}
  </>;
}
