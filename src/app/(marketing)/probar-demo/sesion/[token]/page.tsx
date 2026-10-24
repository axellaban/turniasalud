import type { Metadata, Viewport } from "next";
import { DemoNavegador } from "./demo-navegador";

export const metadata: Metadata = {
  title: "Tu demo de Turnia",
  robots: { index: false, follow: false },
};

// En Android, el teclado achica la pantalla en lugar de taparla: el chat queda entero arriba del teclado.
export const viewport: Viewport = { interactiveWidget: "resizes-content" };

export default async function DemoNavegadorPage({ params }: PageProps<"/probar-demo/sesion/[token]">) {
  const { token } = await params;
  // Mismo ancho y márgenes que la barra del header, para que la demo quede alineada con ella.
  return (
    <section className="bg-gradient-to-b from-[#eef2ff] to-white px-3 sm:px-6">
      <div className="mx-auto max-w-[1240px]">
        <DemoNavegador token={token} />
      </div>
    </section>
  );
}
