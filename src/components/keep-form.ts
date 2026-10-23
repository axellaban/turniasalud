"use client";

import { startTransition, type FormEvent } from "react";

/**
 * Envía el formulario sin el reseteo automático que React aplica a `<form action>`:
 * si el servidor devuelve un error, lo que escribió la persona sigue ahí.
 * Si la acción salió bien y conviene vaciarlo, el componente llama a form.reset().
 */
export function submitKeepingValues(action: (form: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const form = new FormData(event.currentTarget, submitter instanceof HTMLElement ? submitter : undefined);
    startTransition(() => action(form));
  };
}
