"use client";

import { useState } from "react";
import { generarAudioWeb, type AudioWebState } from "../../actions";
import { smallButtonClass } from "@/components/ui";
import type { EstadoAudio } from "@/lib/web-audios";

// Genera los audios de /escucha-a-nuestros-agentes y de la home, de a uno
// (cada uno tarda alrededor de un minuto), con las voces favoritas de ElevenLabs.
export function AudiosWeb({ items }: { items: EstadoAudio[] }) {
  const [estado, setEstado] = useState<Record<string, AudioWebState | "generando">>({});
  const [ocupado, setOcupado] = useState(false);

  async function generar(slugs: string[]) {
    setOcupado(true);
    for (const slug of slugs) {
      setEstado((s) => ({ ...s, [slug]: "generando" }));
      let r: AudioWebState;
      try {
        r = await generarAudioWeb(slug);
      } catch {
        r = { ok: false, slug, message: "Se cortó la conexión. Probá de nuevo." };
      }
      setEstado((s) => ({ ...s, [slug]: r }));
      if (!r.ok) break; // si falta un permiso o créditos, no tiene sentido seguir
    }
    setOcupado(false);
  }

  const faltan = items.filter((i) => !i.generado && !(typeof estado[i.slug] === "object" && (estado[i.slug] as AudioWebState).ok)).map((i) => i.slug);
  const total = items.reduce((t, i) => t + i.caracteres, 0);

  return (
    <div>
      <ul className="divide-y divide-brand-900/5 text-sm">
        {items.map((i) => {
          const e = estado[i.slug];
          const recienGenerado = typeof e === "object" && e.ok;
          return (
            <li key={i.slug} className="py-2.5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-brand-950">{i.titulo}</p>
                  <p className="text-xs text-brand-900/65">
                    {i.caracteres.toLocaleString("es-AR")} caracteres ·{" "}
                    {i.generado ? `generado ${new Date(i.generado).toLocaleDateString("es-AR")}` : recienGenerado ? "generado en esta sesión" : "sin audio"}
                  </p>
                </div>
                <button type="button" disabled={ocupado} onClick={() => generar([i.slug])} className={smallButtonClass}>
                  {e === "generando" ? "Generando…" : i.generado || recienGenerado ? "Regenerar" : "Generar"}
                </button>
              </div>
              {e && e !== "generando" && <p className={`mt-1 text-xs ${e.ok ? "text-brand-700" : "text-red-600"}`}>{e.message}</p>}
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        disabled={ocupado || faltan.length === 0}
        onClick={() => generar(faltan)}
        className="mt-3 w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {ocupado ? "Generando… no cierres esta página" : faltan.length ? `Generar los ${faltan.length} que faltan` : "Todos los audios están generados"}
      </button>
      <p className="mt-2 text-xs text-brand-900/65">
        Usa las voces configuradas en Vercel o tus 2 favoritas de ElevenLabs (Sofi = la femenina).
        Los guiones suman {total.toLocaleString("es-AR")} caracteres; los créditos consumidos dependen de la tarifa del modelo y del plan.
        La clave necesita «Text to Speech» y, para consultar favoritas, «Voices: Read». Regenerar vuelve a consumir créditos.
      </p>
    </div>
  );
}
