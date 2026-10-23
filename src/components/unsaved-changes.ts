"use client";

// Estado compartido «hay cambios sin guardar», para que controles fuera del
// formulario (como el selector de clínica) pidan confirmación antes de descartarlos.
let unsaved = false;

export function setUnsavedChanges(value: boolean): void {
  unsaved = value;
}

/** true si se puede seguir: no hay cambios pendientes o la persona aceptó perderlos. */
export function confirmDiscardUnsaved(): boolean {
  return !unsaved || confirm("Tenés cambios sin guardar. ¿Salir igual y perderlos?");
}
