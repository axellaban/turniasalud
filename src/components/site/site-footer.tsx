import Link from "next/link";
import { Logo } from "@/components/logo";
import { EMPRESA, PLATAFORMA, RECURSOS, SOLUCIONES_CASOS, SOLUCIONES_ESPECIALIDADES, SOLUCIONES_ORGANIZACIONES, type EnlaceMenu } from "@/content/site";
import { FooterCta } from "./footer-cta";
import { Icono } from "./iconos";

function Grupo({ titulo, items }: { titulo: string; items: EnlaceMenu[] }) {
  return (
    <div>
      <p className="text-sm font-semibold text-white">{titulo}</p>
      <ul className="mt-3 space-y-2">
        {items.map((e) => (
          <li key={e.href}>
            <Link href={e.href} className="text-sm text-white/60 hover:text-white">
              {e.nombre}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SiteFooter({ cta = true }: { cta?: boolean }) {
  return (
    <footer className="bg-navy text-white">
      {cta && <FooterCta />}
      <div className="mx-auto max-w-[1240px] border-t border-white/10 px-4 py-14 sm:px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1.2fr_1.4fr_1fr]">
          <div>
            <Logo light />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-white/60">
              Agentes de IA que atienden el WhatsApp y el teléfono de clínicas y consultorios. Hecho en Argentina.
            </p>
            <Link href="/probar-demo" className="mt-5 inline-flex items-center gap-2 rounded-full bg-white/5 px-4 py-2 text-sm text-white/80 hover:bg-white/10">
              <Icono nombre="chat" className="h-4 w-4" /> Probalo con tu web
            </Link>
          </div>
          <Grupo titulo="Plataforma" items={PLATAFORMA} />
          <div className="space-y-8">
            <Grupo titulo="Casos de uso" items={SOLUCIONES_CASOS} />
            <Grupo titulo="Tipos de organización" items={SOLUCIONES_ORGANIZACIONES} />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Especialidades</p>
            <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 lg:grid-cols-1">
              {SOLUCIONES_ESPECIALIDADES.map((e) => (
                <li key={e.href}>
                  <Link href={e.href} className="text-sm text-white/60 hover:text-white">
                    {e.nombre}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-8">
            <Grupo titulo="Recursos" items={RECURSOS} />
            <Grupo titulo="Empresa" items={EMPRESA} />
          </div>
        </div>
        <div className="mt-14 flex flex-col gap-3 border-t border-white/10 pt-6 text-xs text-white/50 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Turnia Salud</p>
          <div className="flex gap-5">
            <Link href="/privacidad" className="hover:text-white">
              Política de privacidad
            </Link>
            <Link href="/pedi-una-demo#contacto" className="hover:text-white">
              Contacto
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
