import { PageHeader, Tabs } from "@/components/ui";
import type { Clinic } from "@/lib/types";

const TABS = [
  { href: "/panel/configuracion", label: "Reglas del consultorio" },
  { href: "/panel/configuracion/equipo", label: "Equipo y horarios" },
  { href: "/panel/configuracion/prestaciones", label: "Prestaciones" },
  { href: "/panel/configuracion/bloqueos", label: "Feriados y bloqueos" },
  { href: "/panel/configuracion/calendario", label: "Calendario" },
  { href: "/panel/configuracion/web", label: "Lectura de la web" },
];

export const WEEKDAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

export function ConfigHeader({ clinic, current }: { clinic: Clinic; current: string }) {
  return <>
    <PageHeader title="Configuración" description={`${clinic.name}. Lo que cambies acá lo usa el agente en las conversaciones nuevas.`} />
    <Tabs items={TABS} current={current} />
  </>;
}
