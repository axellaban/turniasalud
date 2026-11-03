import Link from "next/link";
import { Logo, LogoMark } from "@/components/logo";
import { getPanelClinic, getPanelUser } from "@/lib/panel-clinic";
import { PanelIcon } from "@/components/panel-icons";
import { ClinicSwitcher } from "./clinic-switcher";
import { MarcaInterna } from "./marca-interna";
import { PanelMobileNav, PanelSidebarNav } from "./nav";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: LayoutProps<"/panel">) {
  const [user, clinic] = await Promise.all([getPanelUser(), getPanelClinic()]);
  const admin = user.role === "admin";
  const agent = clinic.agent_name || "Sofi";
  return (
    <div className="flex min-h-screen flex-1 bg-neutral-50/60">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col overflow-y-auto bg-brand-950 text-brand-50 md:flex">
        <Link href="/panel" className="px-5 pb-2 pt-5">
          <Logo light />
        </Link>
        <PanelSidebarNav admin={admin} agent={agent} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-brand-900/10 bg-white/90 px-4 backdrop-blur sm:px-8">
          <Link href="/panel" aria-label="Inicio" className="shrink-0 md:hidden">
            <LogoMark className="h-7 w-7" />
          </Link>
          <ClinicSwitcher />
          {/* Probar al agente queda a un toque desde cualquier pantalla. */}
          <Link
            href="/panel/probar"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
          >
            <PanelIcon name="probar" className="h-[18px] w-[18px]" />
            <span className="sm:hidden">Probar</span>
            <span className="max-sm:hidden">Probar a {agent}</span>
          </Link>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-28 pt-6 sm:px-8 md:pb-12 md:pt-8">{children}</main>
      </div>
      <PanelMobileNav admin={admin} agent={agent} />
      {admin && <MarcaInterna />}
    </div>
  );
}
