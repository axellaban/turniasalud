"use client";

import { useEffect, useState } from "react";
import { dangerButtonClass } from "@/components/ui";
import { deletePatientsAction } from "../../actions";

const WARNING = "Se borran también sus turnos (y sus eventos en Google Calendar), conversaciones y pedidos. No se puede deshacer.";

/** Ficha del paciente → «Borrar ficha». */
export function DeletePatientButton({ id, clinicId, name }: { id: string; clinicId: string; name: string }) {
  return (
    <form
      action={deletePatientsAction}
      onSubmit={(e) => {
        if (!confirm(`¿Borrar la ficha de «${name}»? ${WARNING}`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="ids" value={id} />
      <input type="hidden" name="clinic_id" value={clinicId} />
      <button className={dangerButtonClass}>Borrar ficha</button>
    </form>
  );
}

// Las casillas están en la tabla y se asocian al formulario con el atributo «form»:
// no son hijas del formulario, así que se buscan en form.elements.
const idInputs = (form: HTMLFormElement | null) =>
  form ? Array.from(form.elements).filter((el): el is HTMLInputElement => el instanceof HTMLInputElement && el.name === "ids") : [];

/** Lista de pacientes: «Seleccionar todas» en el encabezado de la tabla. */
export function SelectAllPatients({ formId }: { formId: string }) {
  return (
    <input
      type="checkbox"
      aria-label="Seleccionar todas las fichas de la lista"
      className="size-4 accent-brand-600"
      onChange={(e) => {
        const form = document.getElementById(formId) as HTMLFormElement | null;
        const checked = e.currentTarget.checked;
        idInputs(form).forEach((i) => (i.checked = checked));
        form?.dispatchEvent(new Event("change", { bubbles: true }));
      }}
    />
  );
}

/** Lista de pacientes: borra las fichas marcadas, con confirmación. */
export function DeleteSelectedPatients({ formId }: { formId: string }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    const update = (e?: Event) => {
      const target = e?.target as HTMLInputElement | HTMLFormElement | null;
      if (e && target !== form && (target as HTMLInputElement | null)?.form !== form) return;
      setCount(idInputs(form).filter((i) => i.checked).length);
    };
    update();
    document.addEventListener("change", update);
    return () => document.removeEventListener("change", update);
  }, [formId]);
  return (
    <button
      form={formId}
      disabled={!count}
      className={dangerButtonClass}
      onClick={(e) => {
        const message = count === 1 ? `¿Borrar la ficha seleccionada? ${WARNING}` : `¿Borrar las ${count} fichas seleccionadas? ${WARNING}`;
        if (!confirm(message)) e.preventDefault();
      }}
    >
      {count ? `Borrar ${count === 1 ? "1 ficha" : `${count} fichas`}` : "Marcá las fichas para borrar"}
    </button>
  );
}
