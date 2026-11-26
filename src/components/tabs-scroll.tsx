"use client";
import { useEffect } from "react";

/**
 * Con las pestañas más anchas que la pantalla: deja a la vista la activa y desvanece el borde por
 * donde hay más pestañas (data-fade), para que se note que se puede deslizar.
 */
export function ScrollActiveTab({ id }: { id: string }) {
  useEffect(() => {
    const bar = document.getElementById(id);
    if (!bar) return;
    const active = bar.querySelector<HTMLElement>("[aria-current=page]");
    // Lo justo para que se vea la activa (no centrada): así las pestañas se cortan de un solo lado.
    if (active && bar.scrollWidth > bar.clientWidth) {
      const right = active.offsetLeft + active.clientWidth + 16;
      if (right > bar.clientWidth) bar.scrollLeft = right - bar.clientWidth;
    }
    const mark = () => {
      const left = bar.scrollLeft > 4;
      const right = bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 4;
      const fade = left && right ? "both" : left ? "left" : right ? "right" : "";
      if (fade) bar.dataset.fade = fade;
      else delete bar.dataset.fade;
    };
    mark();
    bar.addEventListener("scroll", mark, { passive: true });
    window.addEventListener("resize", mark);
    return () => { bar.removeEventListener("scroll", mark); window.removeEventListener("resize", mark); };
  }, [id]);
  return null;
}
