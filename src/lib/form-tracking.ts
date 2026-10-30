"use client";
import { useEffect, useRef } from "react";
import { track, type EventProperties } from "@/lib/analytics";

/** El tipo de campo, nunca su valor: "url", "organization", "email"… */
const fieldKind = (target: EventTarget) =>
  target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
    ? ((target as HTMLInputElement).autocomplete || target.name || target.type || "text").slice(0, 30)
    : "other";

/**
 * Los pasos de un formulario, separados: visto (`<prefijo>_form_viewed`), empezado (el primer
 * carácter escrito o autocompletado, `_started`), enviado (`_submitted`) y rechazado (`_error`, con
 * un tipo de error, nunca el mensaje ni lo escrito). `prefix` nombra el formulario: `demo` para
 * /probar-demo, `lead` para «Pedí una demo».
 */
export function useFormTracking(prefix: "demo" | "lead", context: EventProperties = {}) {
  const props = useRef(context);
  useEffect(() => {
    props.current = context;
  });
  const started = useRef(false);
  // Una vez por formulario mostrado: que React repita el efecto en desarrollo no es otra vista.
  const viewed = useRef(false);
  useEffect(() => {
    if (viewed.current) return;
    viewed.current = true;
    track(`${prefix}_form_viewed`, props.current);
  }, [prefix]);
  return {
    /** Para el onInputCapture del formulario. */
    onInput: (e: React.FormEvent) => {
      if (started.current) return;
      started.current = true;
      track(`${prefix}_form_started`, { ...props.current, first_field: fieldKind(e.target) });
    },
    submitted: (extra: EventProperties = {}) => track(`${prefix}_form_submitted`, { ...props.current, ...extra }),
    failed: (errorKind: string, extra: EventProperties = {}) => track(`${prefix}_form_error`, { ...props.current, error_kind: errorKind.slice(0, 40), ...extra }),
  };
}
