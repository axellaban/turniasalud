import Link from "next/link";
import { Logo, LogoMark } from "@/components/logo";
import { getPanelUser } from "@/lib/panel-clinic";
import { ClinicSwitcher } from "./clinic-switcher";
import { MarcaInterna } from "./marca-interna";
import { PanelMobileNav, PanelSidebarNav } from "./nav";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: LayoutProps<"/panel">) {
  const admin = (await getPanelUser()).role === "admin";
  return (
    <div className="flex min-h-screen flex-1 bg-neutral-50/60">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col overflow-y-auto bg-brand-950 text-brand-50 md:flex">
        <Link href="/panel" className="px-5 pb-2 pt-5">
          <Logo light />
        </Link>
        <PanelSidebarNav admin={admin} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-brand-900/10 bg-white/90 px-4 backdrop-blur sm:px-8">
          <Link href="/panel" aria-label="Inicio" className="shrink-0 md:hidden">
            <LogoMark className="h-7 w-7" />
          </Link>
          <ClinicSwitcher />
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-28 pt-6 sm:px-8 md:pb-12 md:pt-8">{children}</main>
      </div>
      <PanelMobileNav admin={admin} />
      {admin && <MarcaInterna />}
    </div>
  );
}
