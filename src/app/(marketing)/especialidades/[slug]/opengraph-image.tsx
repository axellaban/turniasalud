import { TAMANO, imagenPagina } from "@/lib/og";
import { ESPECIALIDADES, getEspecialidad } from "@/content/especialidades";

export const alt = "Turnia Salud por especialidad";
export const size = TAMANO;
export const contentType = "image/png";

export function generateStaticParams() {
  return ESPECIALIDADES.map((e) => ({ slug: e.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const esp = getEspecialidad((await params).slug)!;
  return imagenPagina({ eyebrow: esp.nombre, titulo: esp.titulo, chat: esp.ejemplo, nombreChat: `Turnia · ${esp.nombre}` });
}
