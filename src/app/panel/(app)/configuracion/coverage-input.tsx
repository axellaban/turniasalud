"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { inputClass } from "@/components/ui";

const parse = (value: string) => value.split(",").map((c) => c.trim()).filter(Boolean);

/**
 * Coberturas como etiquetas que se agregan y quitan. Se envían igual que antes:
 * un campo `accepted_coverages` separado por comas.
 */
export function CoverageInput({ name, defaultValue }: { name: string; defaultValue: string[] }) {
  const [items, setItems] = useState(defaultValue);
  const [draft, setDraft] = useState("");
  const hidden = useRef<HTMLInputElement>(null);

  // «Descartar» (reset del formulario) y «Recuperar cambios» actualizan el campo oculto.
  useEffect(() => {
    const form = hidden.current?.form;
    if (!form) return;
    const onReset = () => setItems(defaultValue);
    const onRestore = () => setItems(parse(hidden.current?.value ?? ""));
    form.addEventListener("reset", onReset);
    form.addEventListener("reset-chips", onRestore);
    return () => { form.removeEventListener("reset", onReset); form.removeEventListener("reset-chips", onRestore); };
  }, [defaultValue]);

  const update = (next: string[]) => {
    setItems(next);
    if (!hidden.current) return;
    hidden.current.value = next.join(", ");
    // El formulario detecta los cambios por el evento input.
    hidden.current.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const add = () => {
    const extra = parse(draft).filter((c) => !items.some((i) => i.toLowerCase() === c.toLowerCase()));
    if (extra.length) update([...items, ...extra]);
    setDraft("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); }
    if (e.key === "Backspace" && !draft && items.length) update(items.slice(0, -1));
  };

  return (
    <div>
      {/* Controlado: si no, React lo vuelve al valor inicial en cada render. */}
      <input ref={hidden} type="hidden" name={name} value={items.join(", ")} readOnly />
      {items.length > 0 && <ul className="mb-2 flex flex-wrap gap-1.5">
        {items.map((item) => <li key={item} className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-1 pl-3 pr-1 text-sm text-brand-800">
          {item}
          <button type="button" onClick={() => update(items.filter((i) => i !== item))} aria-label={`Quitar ${item}`} className="rounded-full px-1.5 text-brand-900/65 hover:bg-white hover:text-red-600">×</button>
        </li>)}
      </ul>}
      <div className="flex gap-2">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={add} placeholder="Escribí una cobertura y tocá Enter (ej.: OSDE)" aria-label="Agregar cobertura" className={inputClass} />
        <button type="button" onClick={add} className="shrink-0 rounded-xl px-3 text-sm font-medium text-brand-700 ring-1 ring-brand-200 hover:bg-brand-50">Agregar</button>
      </div>
    </div>
  );
}
