"use client";

import { useState, useTransition, type ReactNode } from "react";
import { statusAction, touchAction, undoTouchAction, type ActionState } from "./actions";

function useRecord() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (action: (form: FormData) => Promise<ActionState>, data: Record<string, string>) => {
    const form = new FormData();
    for (const [key, value] of Object.entries(data)) form.set(key, value);
    setError(null);
    startTransition(async () => {
      const result = await action(form);
      if (result && !result.ok) setError(result.message);
    });
  };
  return { pending, error, run };
}

const ErrorText = ({ text }: { text: string | null }) => (text ? <span role="alert" className="basis-full text-xs text-red-700">{text}</span> : null);

/**
 * Abre el chat con el mensaje escrito, desde el WhatsApp de Axel: en la compu, WhatsApp Web (siempre
 * en la misma pestaña); en el celular, la app. Al tocarlo queda registrado y se programa el seguimiento.
 */
export function WhatsAppButton({ id, web, app, children, className }: { id: string; web: string; app: string; children: ReactNode; className: string }) {
  const { pending, error, run } = useRecord();
  return (
    <>
      <a
        href={app}
        target="turnia-whatsapp"
        aria-busy={pending}
        onClick={(e) => {
          if (!window.matchMedia("(pointer: coarse)").matches) e.currentTarget.href = web;
          run(touchAction, { id, channel: "whatsapp" });
        }}
        className={`${className} ${pending ? "opacity-60" : ""}`}
      >
        {children}
      </a>
      <ErrorText text={error} />
    </>
  );
}

/** Instagram no deja escribir el mensaje desde un link: se copia, se abre el chat y se pega. */
export function InstagramButton({ id, handle, message, className }: { id: string; handle: string; message: string; className: string }) {
  const { pending, error, run } = useRecord();
  const [copied, setCopied] = useState(false);
  return (
    <>
      <a
        href={`https://ig.me/m/${handle}`}
        target="_blank"
        rel="noreferrer"
        aria-busy={pending}
        onClick={() => {
          void navigator.clipboard?.writeText(message).then(() => setCopied(true), () => {});
          run(touchAction, { id, channel: "instagram" });
        }}
        className={`${className} ${pending ? "opacity-60" : ""}`}
      >
        Instagram
      </a>
      {copied && <span className="basis-full text-xs text-brand-900/70">Mensaje copiado: pegalo en el chat de Instagram.</span>}
      <ErrorText text={error} />
    </>
  );
}

export function CallButton({ id, phone, children, className }: { id: string; phone: string; children: ReactNode; className: string }) {
  const { pending, error, run } = useRecord();
  return (
    <>
      <a href={`tel:${phone}`} aria-busy={pending} onClick={() => run(touchAction, { id, channel: "telefono" })} className={`${className} ${pending ? "opacity-60" : ""}`}>
        {children}
      </a>
      <ErrorText text={error} />
    </>
  );
}

/** Un toque: cambia el estado, registra un contacto sin abrir nada (visita, «ya le había escrito») o deshace el último. */
export function ActionButton({
  id,
  kind,
  value,
  children,
  className,
  before = false,
}: {
  id: string;
  kind: "status" | "touch" | "undo";
  value: string;
  children: ReactNode;
  className: string;
  before?: boolean;
}) {
  const { pending, error, run } = useRecord();
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          kind === "status"
            ? run(statusAction, { id, status: value })
            : kind === "undo"
              ? run(undoTouchAction, { id })
              : run(touchAction, { id, channel: value, ...(before ? { before: "1" } : {}) })
        }
        className={`${className} ${pending ? "opacity-60" : ""}`}
      >
        {children}
      </button>
      <ErrorText text={error} />
    </>
  );
}

export function CopyButton({ text, children, className }: { text: string; children: ReactNode; className: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => void navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }, () => {})}
      className={className}
    >
      {copied ? "Copiado" : children}
    </button>
  );
}
