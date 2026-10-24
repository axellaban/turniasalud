"use client";

import { useState } from "react";
import type { MessagingChannel } from "@/lib/messaging-settings";
import { normalizeWebsite } from "@/lib/demo/website";
import { Icono } from "@/components/site/iconos";

type Via = "navegador" | "chat";

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;

/** Celular o tablet: en la computadora casi nadie tiene Telegram o WhatsApp a mano. */
function esCelular(): boolean {
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) return true;
  // El iPad se presenta como una Mac: se lo reconoce por la pantalla táctil.
  return navigator.maxTouchPoints > 1 && window.matchMedia("(pointer: coarse)").matches;
}

/**
 * Web + email. En la computadora la demo sigue en el navegador; en el celular
 * se elige entre el navegador y el chat (Telegram o WhatsApp), si está activo.
 */
export function ProbarDemoForm({ channel, webReady, chatReady }: { channel: MessagingChannel; webReady: boolean; chatReady: boolean }) {
  const [web, setWeb] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<{ campo: "web" | "email" | null; texto: string } | null>(null);
  const [eligiendo, setEligiendo] = useState(false);
  const [pending, setPending] = useState<Via | null>(null);
  const chatName = channel === "telegram" ? "Telegram" : "WhatsApp";

  async function abrir(via: Via) {
    const website = normalizeWebsite(web);
    if (!website) return void setError({ campo: "web", texto: "Revisá la dirección. Por ejemplo: miclinica.com.ar" });
    setError(null);
    setPending(via);
    try {
      const response = await fetch("/api/demo/iniciar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ website, email, via }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo abrir la demo.");
      window.location.assign(result.url);
    } catch (e) {
      setError({ campo: null, texto: e instanceof Error ? e.message : "No se pudo abrir la demo." });
      setPending(null);
    }
  }

  function probar(e: React.FormEvent) {
    e.preventDefault();
    if (!normalizeWebsite(web)) return void setError({ campo: "web", texto: "Revisá la dirección. Por ejemplo: miclinica.com.ar" });
    if (!EMAIL.test(email.trim())) return void setError({ campo: "email", texto: "Revisá tu email. Por ejemplo: nombre@miclinica.com.ar" });
    setError(null);
    const navegador = webReady && !(chatReady && esCelular());
    if (navegador || !chatReady) return void abrir(webReady ? "navegador" : "chat");
    if (!webReady) return void abrir("chat");
    setEligiendo(true);
  }

  if (!webReady && !chatReady) {
    return (
      <p className="mx-auto mt-10 max-w-[560px] rounded-2xl bg-white p-5 text-sm text-tinta ring-1 ring-brand-950/5">
        La demo está pausada por el momento. Volvé en breve o pedí una demo guiada.
      </p>
    );
  }

  if (eligiendo) {
    const opciones: { via: Via; titulo: string; texto: string; icono: "web" | "chat" }[] = [
      { via: "navegador", titulo: "En el navegador", texto: "Seguís acá: chateás o hablás con Sofi sin instalar nada.", icono: "web" },
      { via: "chat", titulo: `Por ${chatName}`, texto: `Te atiende por ${chatName}, como a un paciente. También probás audios.`, icono: "chat" },
    ];
    return (
      <div className="mx-auto mt-10 max-w-[620px] text-left">
        <p className="text-center text-[17px] font-medium text-brand-950">¿Dónde querés probarla?</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {opciones.map((o) => (
            <button
              key={o.via}
              type="button"
              disabled={pending !== null}
              onClick={() => abrir(o.via)}
              className="flex items-start gap-3 rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-brand-950/10 hover:ring-2 hover:ring-brand-600 disabled:opacity-60"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">
                <Icono nombre={o.icono} className="h-5 w-5" />
              </span>
              <span>
                <span className="block font-semibold text-brand-950">{pending === o.via ? "Abriendo…" : o.titulo}</span>
                <span className="mt-1 block text-sm leading-snug text-tinta">{o.texto}</span>
              </span>
            </button>
          ))}
        </div>
        {error && (
          <p role="alert" className="mt-3 text-center text-sm text-red-700">
            {error.texto}
          </p>
        )}
        <p className="mt-4 text-center">
          <button type="button" onClick={() => setEligiendo(false)} disabled={pending !== null} className="text-sm font-medium text-brand-600 hover:underline">
            Cambiar la web o el email
          </button>
        </p>
      </div>
    );
  }

  const campo = "w-full rounded-xl bg-white px-4 py-3.5 text-[16px] text-brand-950 outline-none ring-1 ring-brand-950/10 placeholder:text-tinta/85 focus:ring-2 focus:ring-brand-600 aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-red-600";
  return (
    <form onSubmit={probar} className="mx-auto mt-10 max-w-[620px] text-left" noValidate>
      <div className="grid gap-3 rounded-2xl bg-white p-3 shadow-lg ring-1 ring-brand-950/10 sm:grid-cols-[1fr_1fr_auto]">
        <div>
          <label htmlFor="web" className="sr-only">
            La web de tu consultorio
          </label>
          <input
            id="web"
            name="web"
            type="text"
            inputMode="url"
            autoComplete="url"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={web}
            onChange={(e) => setWeb(e.target.value)}
            placeholder="Tu web: miclinica.com.ar"
            aria-invalid={error?.campo === "web"}
            aria-describedby={error?.campo === "web" ? "demo-error" : undefined}
            className={campo}
          />
        </div>
        <div>
          <label htmlFor="email" className="sr-only">
            Tu email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Tu email"
            aria-invalid={error?.campo === "email"}
            aria-describedby={error?.campo === "email" ? "demo-error" : undefined}
            className={campo}
          />
        </div>
        <button
          type="submit"
          disabled={pending !== null}
          className="rounded-xl bg-brand-600 px-6 py-3.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {pending ? "Abriendo…" : "Probar la demo"}
        </button>
      </div>
      {error ? (
        <p id="demo-error" role="alert" className="mt-3 text-center text-sm text-red-700">
          {error.texto}
        </p>
      ) : (
        <p className="mt-3 text-center text-xs text-tinta">Usamos tu email solo para contactarte sobre la demo.</p>
      )}
    </form>
  );
}
