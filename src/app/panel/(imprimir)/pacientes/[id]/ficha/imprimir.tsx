"use client";

/** Abre el diálogo de impresión del navegador. */
export function PrintButton({ className }: { className: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={className}>
      Imprimir
    </button>
  );
}
