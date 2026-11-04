import { Card } from "@/components/ui";

/** Una sección de Configuración: título, una línea de para qué sirve y sus campos en dos columnas. */
export function Section({ id, title, description, children }: { id: string; title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="scroll-mt-20" id={id}>
      <h2 className="font-semibold text-brand-950">{title}</h2>
      {description && <p className="mt-1 max-w-3xl text-sm text-brand-900/60">{description}</p>}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </Card>
  );
}

export const wide = "sm:col-span-2";
