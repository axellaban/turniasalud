import { TAMANO, imagenPagina } from "@/lib/og";
import { ORGANIZACIONES, getOrganizacion } from "@/content/organizaciones";

export const alt = "Turnia Salud por tipo de organización";
export const size = TAMANO;
export const contentType = "image/jpeg";

export function generateStaticParams() {
  return ORGANIZACIONES.map((o) => ({ slug: o.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const org = getOrganizacion((await params).slug)!;
  return imagenPagina({ eyebrow: org.nombre, titulo: org.titulo });
}
