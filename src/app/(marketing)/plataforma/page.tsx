import type { Metadata } from "next";
import { PaginaProducto } from "@/components/site/producto";
import { PRODUCTOS } from "@/content/productos";

export const metadata: Metadata = {
  title: "Plataforma",
  description: PRODUCTOS.plataforma.bajada,
};

export default function PlataformaPage() {
  return <PaginaProducto p={PRODUCTOS.plataforma} />;
}
