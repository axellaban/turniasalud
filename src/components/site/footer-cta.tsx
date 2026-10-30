"use client";

import Link from "next/link";
import { cta } from "@/lib/analytics-shared";
import { usePathname } from "next/navigation";
import { Flecha } from "./iconos";

// Cierre de cada página: la acción principal (probar con la web) y la secundaria (demo guiada).
// En /probar-demo no se muestra: competiría con el formulario, que es la única acción de esa página.
export function FooterCta() {
  if (usePathname().startsWith("/probar-demo")) return null;
  return (
    <div className="mx-auto max-w-[1240px] px-4 pb-16 pt-24 text-center sm:px-6">
      <h2 className="mx-auto max-w-2xl text-3xl font-medium tracking-tight sm:text-5xl">¿Listo para transformar la atención de tus pacientes con Turnia?</h2>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link href="/probar-demo" {...cta("try_demo", "closing", "probar_demo")} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-6 py-3 text-sm font-semibold text-white hover:bg-brand-700">
          Probalo con tu web <Flecha />
        </Link>
        <Link href="/pedi-una-demo" {...cta("guided_demo", "closing", "pedi_una_demo")} className="inline-flex items-center gap-2 rounded-lg px-6 py-3 text-sm font-semibold text-white ring-1 ring-white/30 hover:bg-white/10">
          Pedí una demo guiada
        </Link>
      </div>
    </div>
  );
}
