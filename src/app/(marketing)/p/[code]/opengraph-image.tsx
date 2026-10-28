import { TAMANO, imagenPagina, imagenPortada } from "@/lib/og";
import { publicOutreach } from "@/lib/sales/outreach";
import { demoExample, dentalServices } from "@/lib/demo/dental-services";
import { ofBusiness, withArticle } from "@/lib/sales/outreach-messages";

// La vista previa del link en WhatsApp: con el nombre de su consultorio en el chat.
export const alt = "Demo de Turnia para tu consultorio";
export const size = TAMANO;
export const contentType = "image/png";
// Se arma una vez por demo y queda guardada un día: WhatsApp espera poco la vista previa y,
// generada en el momento, tarda 2 o 3 segundos.
export const dynamic = "force-static";
export const revalidate = 86400;

export default async function Image({ params }: { params: Promise<{ code: string }> }) {
  const p = await publicOutreach((await params).code).catch(() => null);
  if (!p) return imagenPortada();
  const consultorio = p.business_name || `Consultorio de ${p.name}`;
  return imagenPagina({
    eyebrow: `Demo para ${consultorio}`,
    titulo: "Sofi, atendiendo el WhatsApp de tu consultorio",
    chat: demoExample(dentalServices(p.specialty), withArticle(p.title, p.name), ofBusiness(consultorio), true),
    nombreChat: consultorio,
  });
}
