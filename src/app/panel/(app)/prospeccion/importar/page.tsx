import Link from "next/link";
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/panel-clinic";
import { Card, PageHeader, ghostButtonClass } from "@/components/ui";
import { ImportOutreachForm } from "./import-form";

export const metadata: Metadata = { title: "Importar lista · Prospección" };

export default async function ImportarProspeccionPage() {
  await requireAdmin();
  return (
    <>
      <Link href="/panel/prospeccion" className={`${ghostButtonClass} -ml-3 mb-2`}>
        ← Prospección
      </Link>
      <PageHeader
        title="Importar la lista"
        description="Un CSV o celdas de Excel con una fila por odontólogo. Quien ya estaba solo completa los datos que le faltan: no se pisa lo que corregiste ni su estado."
      />
      <Card>
        <ImportOutreachForm />
        <div className="mt-6 border-t border-brand-900/5 pt-4 text-sm text-brand-900/70">
          <p className="font-medium text-brand-900">Columnas que reconoce</p>
          <p className="mt-1">
            nombre (obligatoria), saludo, tratamiento (Dr. o Dra.), consultorio, zona, dirección, especialidad, teléfono, tipo_telefono (movil o fijo),
            instagram, email, web, prioridad (1 a 3), señales, fuente y código. Sin código, cada persona recibe uno nuevo para su link de demo.
          </p>
          <p className="mt-2">Los datos de contacto quedan solo en la base de Turnia: no los subas al repositorio.</p>
        </div>
      </Card>
    </>
  );
}
