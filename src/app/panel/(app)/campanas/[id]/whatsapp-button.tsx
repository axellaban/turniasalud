"use client";

import { useTransition, type ReactNode } from "react";
import { markManualSentAction } from "../../../campaign-actions";

/**
 * Abre el chat del paciente con el mensaje escrito, en el WhatsApp de la clínica: en la compu,
 * WhatsApp Web (siempre en la misma pestaña); en el celular, la app. Al tocarlo queda como enviado.
 */
export function WhatsAppButton({
  clinicId,
  recipientId,
  web,
  app,
  children,
  className,
}: {
  clinicId: string;
  recipientId: string;
  web: string;
  app: string;
  children: ReactNode;
  className: string;
}) {
  const [pending, startTransition] = useTransition();
  return (
    <a
      href={app}
      target="turnia-whatsapp"
      aria-busy={pending}
      onClick={(e) => {
        // wa.me sirve en todos lados; en una compu conviene ir directo a WhatsApp Web.
        if (!window.matchMedia("(pointer: coarse)").matches) e.currentTarget.href = web;
        const form = new FormData();
        form.set("clinic_id", clinicId);
        form.set("id", recipientId);
        startTransition(() => markManualSentAction(form));
      }}
      className={`${className} ${pending ? "opacity-60" : ""}`}
    >
      {children}
    </a>
  );
}
