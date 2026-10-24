import type { Metadata } from "next";
import { DemoNavegador } from "./demo-navegador";

export const metadata: Metadata = {
  title: "Tu demo de Turnia",
  robots: { index: false, follow: false },
};

export default async function DemoNavegadorPage({ params }: PageProps<"/probar-demo/sesion/[token]">) {
  const { token } = await params;
  return (
    <section className="bg-gradient-to-b from-[#eef2ff] to-white">
      <div className="mx-auto max-w-[1100px] px-4 pb-20 pt-10 sm:px-6 sm:pt-14">
        <DemoNavegador token={token} />
      </div>
    </section>
  );
}
