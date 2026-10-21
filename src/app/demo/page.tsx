import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { DemoClient } from "./demo-client";

export const metadata: Metadata = { title: "Demo" };

export default function DemoPage() {
  return (
    <div className="flex-1">
      <header className="border-b border-brand-900/5">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <Link href="/">
            <Logo />
          </Link>
          <Link href="/panel" className="text-sm font-medium text-brand-700 hover:underline">
            Ver el panel →
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <h1 className="font-display text-3xl tracking-tight text-brand-950 sm:text-4xl">Hablá con Sofi</h1>
        <p className="mt-2 max-w-2xl text-brand-900/70">
          Es el mismo agente que atiende el WhatsApp y el teléfono de la clínica. Pedile un turno, cancelá, preguntá por
          coberturas o pedí una receta.
        </p>
        <div className="mt-8">
          <DemoClient />
        </div>
      </main>
    </div>
  );
}
