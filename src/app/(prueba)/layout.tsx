import Link from "next/link";
import { LogoMark } from "@/components/logo";
import { PanelIcon } from "@/components/panel-icons";

// La prueba del agente desde el panel (/demo): sin el menú ni el pie de la web pública, con la
// vuelta al panel siempre a mano. La barra mide 4,5 rem: la conversación ocupa el resto de la pantalla.
export default function PruebaLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex flex-1 flex-col bg-[#eef2ff]">
      <header className="flex h-[4.5rem] items-center gap-3 px-3 sm:px-6">
        <div className="mx-auto flex w-full max-w-[1240px] items-center gap-3">
          <Link
            href="/panel/probar"
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-1.5 text-sm font-medium text-brand-800 hover:bg-white/70 focus-visible:outline-2 focus-visible:outline-brand-500"
          >
            <PanelIcon name="izquierda" className="h-4 w-4" />
            Volver al panel
          </Link>
          <LogoMark className="ml-auto h-7 w-7" />
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
