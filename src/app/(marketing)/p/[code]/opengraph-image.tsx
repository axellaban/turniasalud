import { TAMANO, imagenPagina, imagenPortada } from "@/lib/og";
import { unstable_cache } from "next/cache";
import { demoPreviewTag, outreachCodes, publicOutreach } from "@/lib/sales/outreach";
import { demoExample, dentalServices } from "@/lib/demo/dental-services";
import { ofBusiness, withArticle } from "@/lib/sales/outreach-messages";

// La vista previa del link en WhatsApp: con el nombre de su consultorio en el chat.
export const alt = "Demo de Turnia para tu consultorio";
export const size = TAMANO;
export const contentType = "image/png";
// WhatsApp espera poco la imagen y, generada en el momento, tarda 2 o 3 segundos: sin ella, el link
// sale sin vista previa. Por eso queda guardada (un día) y, en el deploy de producción, se arman las
// de todos (lo guardado no pasa de un deploy al siguiente). Las que se suman después se arman al
// importar o al saludar (warmDemoPreviews) o, si no, al primer pedido.
export const dynamic = "force-static";
export const revalidate = 86400;

export async function generateStaticParams() {
  if (process.env.VERCEL_ENV !== "production") return [];
  return (await outreachCodes().catch(() => [])).map((code) => ({ code }));
}

// La etiqueta deja rearmar la de una persona cuando cambian sus datos (revalidateTag).
const demo = (code: string) => unstable_cache(() => publicOutreach(code), ["vista-previa", code], { tags: [demoPreviewTag(code)], revalidate })();

export default async function Image({ params }: { params: Promise<{ code: string }> }) {
  const p = await demo((await params).code).catch(() => null);
  if (!p) return imagenPortada();
  const consultorio = p.business_name || `Consultorio de ${p.name}`;
  return imagenPagina({
    eyebrow: `Demo para ${consultorio}`,
    titulo: "Sofi, atendiendo el WhatsApp de tu consultorio",
    chat: demoExample(dentalServices(p.specialty), withArticle(p.title, p.name), ofBusiness(consultorio), true),
    nombreChat: consultorio,
  });
}
