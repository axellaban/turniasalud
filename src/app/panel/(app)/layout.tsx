import Link from "next/link";
import { Logo } from "@/components/logo";
import { logout } from "../actions";
import { ClinicSwitcher } from "./clinic-switcher";
import { PanelNav } from "./nav";

export const dynamic = "force-dynamic";

export default function PanelLayout({ children }: LayoutProps<"/panel">) {
  return (
    <div className="flex min-h-screen flex-1 flex-col md:flex-row">
      <aside className="border-b border-brand-900/10 bg-brand-950 text-brand-50 md:w-60 md:shrink-0 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-5 py-4 md:block">
          <Link href="/panel">
            <Logo light />
          </Link>
          <form action={logout} className="md:hidden">
            <button className="text-xs text-brand-200">Salir</button>
          </form>
        </div>
        <PanelNav />
        <form action={logout} className="hidden px-5 py-6 md:block">
          <button className="text-sm text-brand-200 hover:text-white">Cerrar sesión</button>
        </form>
      </aside>
      <div className="min-w-0 flex-1"><ClinicSwitcher /><main className="px-4 py-6 sm:px-8 sm:py-8">{children}</main></div>
    </div>
  );
}
