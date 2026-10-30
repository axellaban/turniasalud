"use client";

import { useEffect, useRef } from "react";
import { identify, registerSuperProperties, registerSuperPropertiesOnce, track, type EventProperties } from "@/lib/analytics";
import { prospectDistinctId } from "@/lib/analytics-shared";
import { isInternal, markInternal, startDemoEngagement } from "@/lib/interaction-tracking";

/**
 * PostHog en la demo de cada odontólogo: este navegador pasa a ser esa persona de la prospección
 * (la misma a la que el panel le suma el saludo, la demo enviada y los seguimientos), registra la
 * visita y el tiempo activo. Cuando la mira Axel desde el panel (?vista=panel) o un dispositivo del
 * equipo, solo queda marcado como interno y no se identifica.
 */
export function SeguimientoDemo({ code, facts, contar }: { code: string; facts: EventProperties; contar: boolean }) {
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!contar) markInternal("vista_panel");
    // Atribución: lo que haga después este navegador (probar la demo, pedir una guiada) queda con su código.
    registerSuperProperties({ outreach_code: code });
    registerSuperPropertiesOnce({ first_demo_kind: "personal", first_outreach_code: code });
    // En la persona, solo lo de la prospección (prioridad, zona, tipo de teléfono, estado).
    const person = Object.fromEntries(Object.entries(facts).filter(([k]) => k.startsWith("prospect_")));
    if (contar && !isInternal()) identify(prospectDistinctId(code), person, { prospect_code: code });
    track("personal_demo_viewed", { ...facts, preview: !contar });
  }, [code, facts, contar]);
  useEffect(() => startDemoEngagement({ demo_kind: "personal" }), []);
  return null;
}
