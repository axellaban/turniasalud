import Link from "next/link";
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/panel-clinic";
import { Card, Notice, PageHeader, ghostButtonClass } from "@/components/ui";
import { appsScriptCode, sheetKey, sheetSettings } from "@/lib/leads-sheet";
import { formatDateTime } from "@/lib/time";
import { ConnectSheetForm, CopyCode, SheetButtons } from "./sheet-form";

export const metadata: Metadata = { title: "Google Sheets · Pedidos de demo" };

export default async function PlanillaPage() {
  await requireAdmin();
  const settings = await sheetSettings();
  const code = appsScriptCode(sheetKey());
  return (
    <>
      <Link href="/panel/demos" className={`${ghostButtonClass} -ml-3 mb-2`}>
        ← Pedidos de demo
      </Link>
      <PageHeader
        title="Pedidos de demo en Google Sheets"
        description="Cada pedido que llega (el formulario «Pedí una demo» y quienes prueban la demo) se copia solo en tu planilla, y se actualiza cuando le cambiás el estado o las notas."
      />

      {settings.url ? (
        <Card className="mb-6">
          <h2 className="font-display text-xl text-brand-950">Conectada con «{settings.name}»</h2>
          <p className="mt-1 text-sm text-brand-900/70">
            {settings.synced_at ? `Última copia: ${formatDateTime(settings.synced_at)}.` : "Todavía no se copió ningún pedido."}
          </p>
          {settings.error && <Notice tone="error" className="mt-3">{settings.error}</Notice>}
          <SheetButtons />
        </Card>
      ) : (
        <Notice className="mb-6">Todavía no hay una planilla conectada. Son cinco pasos y se hacen una sola vez.</Notice>
      )}

      <Card>
        <h2 className="font-display text-xl text-brand-950">{settings.url ? "Conectar otra planilla" : "Cómo conectarla"}</h2>
        <ol className="mt-4 list-decimal space-y-4 pl-5 text-sm text-brand-900/85">
          <li>
            Creá una planilla nueva en Google Sheets (
            <a href="https://sheets.new" target="_blank" rel="noreferrer" className="text-brand-600 underline">
              sheets.new
            </a>
            ) y ponele un nombre, por ejemplo «Turnia · Pedidos de demo».
          </li>
          <li>
            En la planilla, abrí <strong>Extensiones → Apps Script</strong>. Borrá lo que aparece, pegá este código y guardá (el ícono del disquete). Ya
            tiene tu clave: no lo compartas.
            <CopyCode code={code} />
          </li>
          <li>
            Arriba a la derecha: <strong>Implementar → Nueva implementación</strong>. En «Seleccionar tipo», elegí <strong>Aplicación web</strong>.
            «Ejecutar como»: <strong>Yo</strong>. «Quién tiene acceso»: <strong>Cualquier persona</strong>. Tocá «Implementar» y autorizá con tu cuenta
            (si Google avisa que la app no está verificada: «Configuración avanzada» → «Ir a…»; es tu propio código).
          </li>
          <li>
            Copiá la <strong>URL de la aplicación web</strong> (termina en <code>/exec</code>) y pegala acá:
            <ConnectSheetForm current={settings.url} />
          </li>
          <li>Con la planilla conectada, tocá «Copiar los pedidos que ya hay» para traer los anteriores. Desde ahí, los nuevos llegan solos.</li>
        </ol>
        <p className="mt-5 text-xs text-brand-900/65">
          Si cambiás el código en Apps Script, implementá una versión nueva (Implementar → Administrar implementaciones → editar → Nueva versión): la URL
          sigue siendo la misma. La planilla tiene datos de contacto de personas: compartila solo con quien la necesita.
        </p>
      </Card>
    </>
  );
}
