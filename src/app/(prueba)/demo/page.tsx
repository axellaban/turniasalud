import type { Metadata, Viewport } from "next";
import { getCatalog } from "@/lib/clinic";
import { getPanelClinic } from "@/lib/panel-clinic";
import { DemoClinica } from "./demo-clinica";

export const metadata: Metadata = {
  title: "Probar el agente",
  robots: { index: false, follow: false },
};

// En Android, el teclado achica la pantalla en lugar de taparla: el chat queda entero arriba del teclado.
export const viewport: Viewport = { interactiveWidget: "resizes-content" };

// Desde el panel: hablar con el agente de la clínica elegida, con su agenda de verdad.
// Se ve igual que la demo de /probar-demo.
export default async function DemoPage() {
  const clinic = await getPanelClinic();
  const catalog = await getCatalog(clinic.id);
  return (
    <section className="bg-gradient-to-b from-[#eef2ff] to-white px-3 sm:px-6">
      <div className="mx-auto max-w-[1240px]">
        <DemoClinica
          demo={clinic.is_demo}
          clinic={{
            name: clinic.name,
            agentName: clinic.agent_name,
            specialty: clinic.specialty,
            address: clinic.address,
            professionals: catalog.professionals.map((p) => p.full_name).slice(0, 8),
            types: catalog.appointmentTypes.filter((t) => !t.panel_only).map((t) => t.name).slice(0, 8),
          }}
        />
      </div>
    </section>
  );
}
