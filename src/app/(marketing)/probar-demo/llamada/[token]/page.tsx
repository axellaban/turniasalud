import type { Metadata } from "next";
import { LlamadaDemo } from "./llamada-demo";

export const metadata: Metadata = {
  title: "Llamada de la demo",
  robots: { index: false, follow: false },
};

export default async function LlamadaDemoPage({ params }: PageProps<"/probar-demo/llamada/[token]">) {
  const { token } = await params;
  return (
    <section className="bg-gradient-to-b from-[#eef2ff] to-white">
      <div className="mx-auto max-w-[560px] px-4 pb-24 pt-16 text-center sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-600">Demo de Turnia · Llamada de voz</p>
        <LlamadaDemo token={token} />
      </div>
    </section>
  );
}
