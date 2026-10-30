"use client";

import { useEffect } from "react";
import { markInternal } from "@/lib/interaction-tracking";

/**
 * El navegador del administrador queda marcado como del equipo: lo que haga después en la web o en
 * las demos sale con is_internal y los tableros de PostHog lo dejan afuera. El panel en sí no se mide.
 */
export function MarcaInterna() {
  useEffect(() => markInternal("panel"), []);
  return null;
}
