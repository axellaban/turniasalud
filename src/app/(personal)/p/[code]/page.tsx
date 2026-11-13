import type { Metadata, Viewport } from "next";
import { notFound, redirect } from "next/navigation";
import { demoStatus } from "@/lib/demo/config";
import { chatSuggestions, demoExample, dentalServices } from "@/lib/demo/dental-services";
import { DENTAL_TYPES } from "@/lib/demo/profile";
import { isConfigured } from "@/lib/env";
import { TAMANO } from "@/lib/og";
import { demoPreviewVersion } from "@/lib/sales/demo-preview";
import { doctorsMessage, publicOutreach, type PublicOutreach } from "@/lib/sales/outreach";
import { cleanDemoCode, ofBusiness, withArticle } from "@/lib/sales/outreach-messages";
import { demoContactLine } from "@/lib/sales/voice-outreach";
import { DemoPersonal } from "./demo-personal";
import { SeguimientoDemo } from "./seguimiento-demo";

// La demo de cada odontólogo de la prospección: llega por el link del mensaje de Axel. Es una sola
// pantalla: la esfera de Sofi en el centro, el chat arriba a la derecha y la ficha de su consultorio abajo.
export const dynamic = "force-dynamic";

/** «Dra. Myriam Moreta» si sabemos cómo se presenta; si no, su nombre. */
const profesional = (p: PublicOutreach) => (p.title ? `${p.title} ${p.name}` : p.name);
const consultorio = (p: PublicOutreach) => p.business_name || `Consultorio de ${p.name}`;

// En Android, el teclado achica la pantalla en lugar de taparla: el chat queda entero arriba del teclado.
export const viewport: Viewport = { interactiveWidget: "resizes-content", themeColor: "#f7f9fd" };

export async function generateMetadata({ params }: PageProps<"/p/[code]">): Promise<Metadata> {
  const p = await publicOutreach((await params).code);
  if (!p) return { title: "Demo de Turnia", robots: { index: false, follow: false } };
  const title = `Demo para ${consultorio(p)}`;
  const description = "Probá cómo Sofi atiende el WhatsApp de tu consultorio: contesta al instante, también a la noche y el fin de semana, y da los turnos.";
  // La imagen ya armada (src/lib/sales/demo-preview.ts): WhatsApp no espera a que se arme.
  const images = [{ url: `/p/${p.code}/vista-previa?v=${demoPreviewVersion(p)}`, ...TAMANO, type: "image/jpeg", alt: "Demo de Turnia para tu consultorio" }];
  return { title, description, robots: { index: false, follow: false }, openGraph: { title, description, images }, twitter: { title, description, images } };
}

/** Lo mismo que pidió, con el código limpio: así no se pierde `?vista=panel`. */
function sameQuery(query: Record<string, string | string[] | undefined>): string {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) for (const v of [value ?? []].flat()) out.append(key, v);
  const text = out.toString();
  return text ? `?${text}` : "";
}

export default async function DemoPersonalPage({ params, searchParams }: PageProps<"/p/[code]">) {
  const { code } = await params;
  const query = await searchParams;
  const p = await publicOutreach(code);
  if (!p) {
    // El link llegó con algo pegado al final («…/p/perez-k3m7x):»): a su demo, no a «no encontrada».
    const limpio = cleanDemoCode(code);
    if (limpio && (await publicOutreach(limpio))) redirect(`/p/${limpio}${sameQuery(query)}`);
    notFound();
  }
  // Axel la abre desde el panel para ver lo que recibe el odontólogo: no cuenta como visita.
  const contar = query.vista !== "panel";
  const [status, reenvio, linea] = await Promise.all([demoStatus(), doctorsMessage(p), demoContactLine(p.code)]);
  const lista = status.base && isConfigured().elevenlabs;
  // La demo se arma con lo que ya sabemos de su consultorio (al instante, sin leer su web): sus
  // tratamientos (Doctoralia) suman sus turnos de primera vez y el ejemplo que se le sugiere decir.
  const services = dentalServices(p.specialty);
  const direccion = [p.address, p.zone].filter(Boolean).join(", ") || null;
  const datos = {
    nombre: consultorio(p),
    direccion,
    especialidad: "Odontología",
    profesional: profesional(p),
    servicios: services.length ? p.specialty : null,
  };
  const ejemplo = demoExample(services, withArticle(p.title, p.name), ofBusiness(consultorio(p)));
  // Para PostHog: lo que sirve para comparar, sin nombre ni teléfono (ANALITICA.md).
  const facts = {
    prospect_priority: p.priority,
    prospect_zone: p.zone,
    prospect_phone_kind: p.phone_kind ?? "",
    prospect_status: p.status,
    with_web: Boolean(p.website),
    demo_ready: lista,
    talked_to_sofi: p.converso,
  };

  return (
    <>
      <SeguimientoDemo code={p.code} facts={facts} contar={contar} />
      <DemoPersonal
        code={p.code}
        contar={contar}
        lista={lista}
        datos={datos}
        reenvio={reenvio}
        linea={linea}
        ficha={{
          consultorio: consultorio(p),
          profesional: profesional(p),
          direccion,
          turnos: [...DENTAL_TYPES.map((t) => t.nombre), ...services.map((s) => s.turno)],
        }}
        ejemplos={chatSuggestions(ejemplo.paciente)}
      />
    </>
  );
}
