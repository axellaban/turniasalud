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
    if (active && bar.scrollWidth > bar.clientWidth) bar.scrollLeft = active.offsetLeft - bar.clientWidth / 2 + active.clientWidth / 2;
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
