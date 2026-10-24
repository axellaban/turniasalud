"use client";

import { useState } from "react";
import type { MessagingChannel } from "@/lib/messaging-settings";
import { normalizeManualClinic, normalizeWebsite, type ManualClinic } from "@/lib/demo/website";
import { Icono } from "@/components/site/iconos";

type Via = "navegador" | "chat";
type Modo = "web" | "nombre";

/** Celular o tablet: en la computadora casi nadie tiene Telegram o WhatsApp a mano. */
function esCelular(): boolean {
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) return true;
  // El iPad se presenta como una Mac: se lo reconoce por la pantalla táctil.
  return navigator.maxTouchPoints > 1 && window.matchMedia("(pointer: coarse)").matches;
}

/**
 * La web del consultorio o, si no tiene, su nombre. En la computadora la demo
 * sigue en el navegador; en el celular, con web, se elige entre el navegador y
 * el chat (Telegram o WhatsApp), si está activo. Sin web va siempre al navegador.
 */
export function ProbarDemoForm({
  channel,
  webReady,
  chatReady,
  initialWeb = "",
  initialManual = null,
}: {
  channel: MessagingChannel;
  webReady: boolean;
  chatReady: boolean;
  /** Web que trae el link personalizado. */
  initialWeb?: string;
  /** Consultorio sin web que trae el link personalizado (nombre, dirección y especialidad). */
  initialManual?: ManualClinic | null;
}) {
  const [modo, setModo] = useState<Modo>(initialManual ? "nombre" : "web");
  const [web, setWeb] = useState(initialWeb);
  const [nombre, setNombre] = useState(initialManual?.nombre ?? "");
  const [especialidad, setEspecialidad] = useState(initialManual?.especialidad ?? "");
  const [error, setError] = useState<{ campo: "web" | "nombre" | null; texto: string } | null>(null);
  const [eligiendo, setEligiendo] = useState(false);
  const [pending, setPending] = useState<Via | null>(null);
  const chatName = channel === "telegram" ? "Telegram" : "WhatsApp";

  async function abrir(via: Via, body: Record<string, unknown>) {
    setError(null);
    setPending(via);
    try {
      const response = await fetch("/api/demo/iniciar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, via }),
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
    if (modo === "nombre") {
      const manual = normalizeManualClinic({ nombre, direccion: initialManual?.direccion, especialidad });
      if (!manual) return void setError({ campo: "nombre", texto: "Escribí el nombre del consultorio. Por ejemplo: Consultorio Pérez" });
      if (!webReady) return void setError({ campo: null, texto: "La demo sin web no está disponible por el momento." });
      return void abrir("navegador", manual);
    }
    const website = normalizeWebsite(web);
    if (!website) return void setError({ campo: "web", texto: "Revisá la dirección. Por ejemplo: miclinica.com.ar" });
    setError(null);
    const navegador = webReady && !(chatReady && esCelular());
    if (navegador || !chatReady) return void abrir(webReady ? "navegador" : "chat", { website });
    if (!webReady) return void abrir("chat", { website });
    setEligiendo(true);
  }

  function cambiarModo(next: Modo) {
    setModo(next);
    setError(null);
  }

  if (!webReady && !chatReady) {
    return (
      <p className="mx-auto mt-10 max-w-[560px] rounded-2xl bg-white p-5 text-sm text-tinta ring-1 ring-brand-950/5">
        La demo está pausada por el momento. Volvé en breve o pedí una demo guiada.
      </p>
    );
  }

  if (eligiendo) {
    const website = normalizeWebsite(web);
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
              onClick={() => abrir(o.via, { website })}
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
            Cambiar la web
          </button>
        </p>
      </div>
    );
  }

  const campo = "w-full rounded-xl bg-white px-4 py-3.5 text-[16px] text-brand-950 outline-none ring-1 ring-brand-950/10 placeholder:text-tinta/85 focus:ring-2 focus:ring-brand-600 aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-red-600";
  const boton = (
    <button
      type="submit"
      disabled={pending !== null}
      className="rounded-xl bg-brand-600 px-6 py-3.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
    >
      {pending ? "Abriendo…" : "Probar la demo"}
    </button>
  );
  return (
    <form onSubmit={probar} className="mx-auto mt-10 max-w-[620px] text-left" noValidate>
      {modo === "web" ? (
        <div className="grid gap-3 rounded-2xl bg-white p-3 shadow-lg ring-1 ring-brand-950/10 sm:grid-cols-[1fr_auto]">
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
          {boton}
        </div>
      ) : (
        <div className="grid gap-3 rounded-2xl bg-white p-3 shadow-lg ring-1 ring-brand-950/10 sm:grid-cols-[1.3fr_1fr_auto]">
          <div>
            <label htmlFor="nombre" className="sr-only">
              Nombre del consultorio
            </label>
            <input
              id="nombre"
              name="nombre"
              type="text"
              autoComplete="organization"
              required
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Nombre del consultorio"
              aria-invalid={error?.campo === "nombre"}
              aria-describedby={error?.campo === "nombre" ? "demo-error" : undefined}
              className={campo}
            />
          </div>
          <div>
            <label htmlFor="especialidad" className="sr-only">
              Especialidad
            </label>
            <input
              id="especialidad"
              name="especialidad"
              type="text"
              value={especialidad}
              onChange={(e) => setEspecialidad(e.target.value)}
              placeholder="Especialidad"
              className={campo}
            />
          </div>
          {boton}
        </div>
      )}
      {error ? (
        <p id="demo-error" role="alert" className="mt-3 text-center text-sm text-red-700">
          {error.texto}
        </p>
      ) : (
        <p className="mt-3 text-center text-xs text-tinta">Es gratis y no hace falta registrarse. Los turnos son de prueba.</p>
      )}
      <p className="mt-2 text-center">
        <button type="button" onClick={() => cambiarModo(modo === "web" ? "nombre" : "web")} className="text-sm font-medium text-brand-600 hover:underline">
          {modo === "web" ? "¿Tu consultorio no tiene web? Probala con su nombre" : "¿Tiene web? Probala con la web"}
        </button>
      </p>
    </form>
  );
}
