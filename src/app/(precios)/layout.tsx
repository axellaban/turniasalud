import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";

// Como la web pública, pero sin la banda «¿Listo para…?» del footer (/pricing ya cierra con su formulario) y
// sin la lista de especialidades médicas: los precios son para consultorios odontológicos.
export default function PreciosLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter cta={false} especialidades={false} />
    </div>
  );
}
