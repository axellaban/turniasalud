import { PageHeader, Tabs } from "@/components/ui";
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

export function ConfigHeader({ clinic, current }: { clinic: Clinic; current: string }) {
  return <>
    <PageHeader title="Configuración" description={`${clinic.name}. Lo que cambies acá lo usa ${clinic.agent_name || "Sofi"} desde el próximo mensaje.`} />
    <Tabs items={TABS} current={current} />
  </>;
}
