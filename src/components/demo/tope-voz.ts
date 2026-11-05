"use client";

import { useEffect, useRef } from "react";
import { CALL_LIMITS } from "@/lib/chat-limits";

const MINUTOS = CALL_LIMITS.webDemoSeconds / 60;
export const TOPE_VOZ_AVISO = `La prueba por voz dura hasta ${MINUTOS} minutos. Si querés seguir, llamá de nuevo o escribile por chat.`;
export const TOPE_LLAMADA_AVISO = `La llamada de prueba dura hasta ${MINUTOS} minutos.`;

/**
 * Corta la charla por voz de una demo al llegar al tope (3 minutos), aunque la persona siga
 * hablando: la voz es lo que más cuesta y una demo no necesita más.
 */
export function useTopeDeVoz(activa: boolean, alLlegar: () => void) {
  const callback = useRef(alLlegar);
  useEffect(() => {
    callback.current = alLlegar;
  });
  useEffect(() => {
    if (!activa) return;
    const timer = window.setTimeout(() => callback.current(), CALL_LIMITS.webDemoSeconds * 1000);
    return () => window.clearTimeout(timer);
  }, [activa]);
}
