"use client";

import { cta } from "@/lib/analytics-shared";
import { mensajeParaAxel, whatsappAxel } from "@/lib/sales/contacto-axel";
import type { TalkPlace } from "@/lib/sales/outreach-places";

// «Escribirle a Axel»: el paso que sigue a la demo en todo el recorrido. Abre su WhatsApp con el
// mensaje escrito, se mide en PostHog (`talk_axel`) y, si la demo es de una persona de la
// prospección, queda en su ficha.

function avisar(codigo: string, donde: TalkPlace) {
  const url = `/api/p/${codigo}?accion=whatsapp&donde=${donde}`;
  try {
    if (navigator.sendBeacon(url)) return;
  } catch {}
  void fetch(url, { method: "POST", keepalive: true }).catch(() => {});
}

export function IconoWhatsapp({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
    </svg>
  );
}

const ESTILO = {
  // Verde de WhatsApp oscurecido: el blanco encima pasa 4,5:1.
  primario:
    "inline-flex items-center justify-center gap-2 rounded-xl bg-[#0f7a40] px-6 py-3.5 text-[15px] font-semibold text-white shadow-lg shadow-[#0f7a40]/20 transition-colors hover:bg-[#0b6434] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f7a40]",
  secundario:
    "inline-flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-[15px] font-semibold text-[#0b6434] ring-1 ring-[#0f7a40]/30 transition-colors hover:bg-[#0f7a40]/5",
  enlace: "inline-flex items-center gap-1.5 font-medium text-[#0b6434] underline-offset-2 hover:underline",
} as const;

export function BotonAxel({
  texto,
  donde,
  codigo,
  variante = "primario",
  className = "",
  children = "Escribirle a Axel",
}: {
  texto: string;
  donde: TalkPlace;
  /** La persona de la prospección (su /p/<código>); sin código, solo se mide en PostHog. */
  codigo?: string | null;
  variante?: keyof typeof ESTILO;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <a
      href={whatsappAxel(texto)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => codigo && avisar(codigo, donde)}
      {...cta("talk_axel", donde, "whatsapp")}
      className={`${ESTILO[variante]} ${className}`}
    >
      <IconoWhatsapp className={variante === "enlace" ? "h-4 w-4" : "h-5 w-5"} />
      {children}
    </a>
  );
}

/**
 * Lo que aparece en el chat cuando termina una conversación con Sofi: una nota de Axel con un solo
 * paso, escribirle. La demo sigue a mano (escribir o llamar de nuevo), pero ya no es lo principal.
 */
export function CierreDemo({ consultorio, saludo, codigo }: { consultorio: string; saludo?: string | null; codigo?: string | null }) {
  return (
    <div className="animar-aparecer mx-auto mt-4 w-full max-w-md rounded-2xl bg-white p-4 text-left shadow-[0_12px_32px_rgb(8_24_63/0.10)] ring-1 ring-brand-950/10 sm:p-5">
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-950 text-sm font-semibold text-white" aria-hidden="true">
          A
        </span>
        <p className="text-sm leading-tight">
          <span className="block font-semibold text-brand-950">Axel</span>
          <span className="text-xs text-tinta">Turnia</span>
        </p>
      </div>
      <p className="mt-3 text-[17px] font-semibold leading-snug text-brand-950">
        {saludo ? `${saludo}, ¿la` : "¿La"} dejamos atendiendo en {consultorio}?
      </p>
      <p className="mt-1.5 text-[15px] leading-relaxed text-tinta">
        Escribime y en 15 minutos te muestro cómo queda con tus horarios, tus tratamientos y tu agenda real.
      </p>
      <BotonAxel texto={mensajeParaAxel({ saludo, consultorio, probo: true })} donde="cierre" codigo={codigo} className="mt-4 w-full" />
      <p className="mt-2 text-center text-xs text-tinta">Te contesto yo, por WhatsApp.</p>
    </div>
  );
}
