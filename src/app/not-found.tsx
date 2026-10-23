import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { buttonClass, secondaryButtonClass } from "@/components/ui";

export const metadata: Metadata = { title: "Página no encontrada" };

// Cualquier dirección que no existe: una página propia, con salida, en vez del 404 negro.
export default function NotFound() {
  return (
    <main className="grid flex-1 place-items-center px-4 py-16">
      <div className="w-full max-w-md text-center">
        <Link href="/" className="mb-8 inline-flex justify-center"><Logo /></Link>
        <p className="text-sm font-semibold text-brand-600">Error 404</p>
        <h1 className="mt-2 font-display text-3xl tracking-tight text-brand-950">No encontramos esta página</h1>
        <p className="mt-3 text-sm text-brand-900/65">Puede que la dirección esté mal escrita o que la página ya no exista.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link href="/panel" className={buttonClass}>Ir al panel</Link>
          <Link href="/" className={secondaryButtonClass}>Ir a la web</Link>
        </div>
      </div>
    </main>
  );
}
