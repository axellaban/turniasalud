"use client";

import { useEffect } from "react";

/** En pantallas angostas, centra la pestaña activa dentro de la barra que se desliza. */
export function ScrollActiveTab({ id }: { id: string }) {
  useEffect(() => {
    const bar = document.getElementById(id);
    const active = bar?.querySelector<HTMLElement>("[aria-current=page]");
    if (bar && active && bar.scrollWidth > bar.clientWidth) bar.scrollLeft = active.offsetLeft - bar.clientWidth / 2 + active.clientWidth / 2;
  }, [id]);
  return null;
}
