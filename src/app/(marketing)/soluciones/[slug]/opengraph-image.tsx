import { TAMANO, imagenPagina } from "@/lib/og";
import { CASOS, getCaso } from "@/content/casos";

export const alt = "Turnia Salud por caso de uso";
export const size = TAMANO;
export const contentType = "image/jpeg";

export function generateStaticParams() {
  return CASOS.map((c) => ({ slug: c.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const caso = getCaso((await params).slug)!;
  return imagenPagina({ eyebrow: caso.nombre, titulo: caso.titulo });
}
