import type { Metadata } from "next";
import { PaginaProducto } from "@/components/site/producto";
import { PRODUCTOS } from "@/content/productos";

export const metadata: Metadata = {
  title: "Turnia Recepción",
  description: PRODUCTOS.recepcion.bajada,
};

export default function RecepcionPage() {
  return <PaginaProducto p={PRODUCTOS.recepcion} />;
}
