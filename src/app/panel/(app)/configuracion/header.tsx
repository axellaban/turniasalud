import Link from "next/link";
import { Notice, PageHeader, Tabs } from "@/components/ui";
import { sql } from "@/lib/db";
import { configConflicts, type ConfigConflict } from "@/lib/config-conflicts";
import type { Clinic } from "@/lib/types";

// En el orden en que se arma un consultorio: quién es, quién atiende y cuándo, qué se da, con qué
// cobertura, las reglas de los turnos y, al final, los días sin atención y la conexión con Google.
const TABS = [
  { href: "/panel/configuracion", label: "Consultorio" },
  { href: "/panel/configuracion/equipo", label: "Equipo y horarios" },
  { href: "/panel/configuracion/prestaciones", label: "Prestaciones" },
  { href: "/panel/configuracion/coberturas", label: "Coberturas" },
  { href: "/panel/configuracion/turnos", label: "Turnos y urgencias" },
  { href: "/panel/configuracion/bloqueos", label: "Feriados y bloqueos" },
  { href: "/panel/configuracion/calendario", label: "Google Calendar" },
];

export const WEEKDAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

/**
 * El mismo dato escrito en dos lugares que no dicen lo mismo (condiciones contra reglas, precios,
 * formas de pago). Lo cargan las pestañas donde viven esos datos y se avisa arriba.
 */
export async function loadConfigConflicts(clinic: Clinic): Promise<ConfigConflict[]> {
  const prices = (await sql<{ price: number }[]>`
    select distinct price::int as price from appointment_types where clinic_id = ${clinic.id} and active and price is not null`).map((r) => r.price);
  return configConflicts(clinic, prices);
}

export function ConfigHeader({ clinic, current, conflicts = [] }: { clinic: Clinic; current: string; conflicts?: ConfigConflict[] }) {
  return <>
    <PageHeader title="Configuración" description={`${clinic.name}. Lo que cambies acá lo usa ${clinic.agent_name || "Sofi"} desde el próximo mensaje.`} />
    <Tabs items={TABS} current={current} />
    {conflicts.length > 0 && (
      <Notice tone="warning" className="mb-6">
        <p className="font-semibold">{conflicts.length === 1 ? "Hay un dato que se contradice" : `Hay ${conflicts.length} datos que se contradicen`}</p>
        <ul className="mt-1 space-y-1">
          {conflicts.map((c) => (
            <li key={c.key}>
              {c.message} <Link href={c.href} className="font-semibold text-brand-700 hover:underline">Corregir →</Link>
            </li>
          ))}
        </ul>
      </Notice>
    )}
  </>;
}
