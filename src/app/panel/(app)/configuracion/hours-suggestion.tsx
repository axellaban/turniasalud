"use client";
import { smallButtonClass } from "@/components/ui";

/** «Usar este texto»: copia en el campo el horario armado con Equipo y horarios (queda para guardar). */
export function HoursSuggestion({ suggestion, mismatch }: { suggestion: string; mismatch: boolean }) {
  const use = (e: React.MouseEvent<HTMLButtonElement>) => {
    const input = e.currentTarget.form?.elements.namedItem("hours_text");
    if (!(input instanceof HTMLInputElement)) return;
    input.value = suggestion;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  };
  return (
    <p className={`mt-1.5 flex flex-wrap items-center gap-2 text-xs ${mismatch ? "text-sun-700" : "text-brand-900/60"}`}>
      <span>{mismatch ? "No coincide con Equipo y horarios, que dice:" : "Según Equipo y horarios:"} «{suggestion}»</span>
      <button type="button" onClick={use} className={smallButtonClass}>Usar este texto</button>
    </p>
  );
}
