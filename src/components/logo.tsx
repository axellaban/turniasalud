/**
 * Isotipo de Turnia (32×32): una burbuja de conversación con la T calada. Es la misma figura en el
 * logo, el favicon, el ícono de app y las miniaturas para compartir (`src/lib/og.tsx`).
 */
export const MARK_PATH =
  "M9.5 3H22.5A7.5 7.5 0 0 1 30 10.5V18.5A7.5 7.5 0 0 1 22.5 26H13.5L7.2 30.6A1.2 1.2 0 0 1 5.3 29.6V25.4A7.5 7.5 0 0 1 2 18.5V10.5A7.5 7.5 0 0 1 9.5 3Z" +
  "M11.6 8.9H20.4A1.8 1.8 0 0 1 20.4 12.5H17.8V19.2A1.8 1.8 0 0 1 14.2 19.2V12.5H11.6A1.8 1.8 0 0 1 11.6 8.9Z";

/** El isotipo solo, del color del texto (`currentColor`). */
export function TurniaMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <path d={MARK_PATH} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}

/** Ícono de app (avatar del agente, encabezado del celular): el isotipo blanco sobre el cuadrado azul. */
export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="9" className="fill-brand-600" />
      <path d={MARK_PATH} fill="#fff" fillRule="evenodd" transform="translate(5.6 5.1) scale(0.65)" />
    </svg>
  );
}

/** Logo completo: isotipo y «Turnia» en negrita con «Salud» liviano, de un solo color. */
export function Logo({ light = false }: { light?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2 ${light ? "text-white" : "text-brand-950"}`}>
      <TurniaMark className={`h-7 w-7 shrink-0 ${light ? "text-white" : "text-brand-600"}`} />
      <span className="whitespace-nowrap text-[21px] leading-none tracking-[-0.035em]">
        <span className="font-bold">Turnia</span> <span className="font-light">Salud</span>
      </span>
    </span>
  );
}
