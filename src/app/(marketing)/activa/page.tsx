import type { Metadata } from "next";
import { PaginaProducto } from "@/components/site/producto";
import { PRODUCTOS } from "@/content/productos";

export const metadata: Metadata = {
  title: "Turnia Activa",
  description: PRODUCTOS.activa.bajada,
};

export default function ActivaPage() {
  return <PaginaProducto p={PRODUCTOS.activa} />;
}
