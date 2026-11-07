"use client";

import { useEffect, useRef, useState } from "react";
import { ConversationProvider } from "@elevenlabs/react";
import { BotonAxel } from "@/components/demo/axel";
import { EsferaCielo } from "@/components/demo/esfera-cielo";
import { useCharlaDemo, type DemoCredential, type DemoMode } from "@/components/demo/use-charla-demo";
import { Logo } from "@/components/logo";
import { Chevron, Icono } from "@/components/site/iconos";
import { analyticsId, track } from "@/lib/analytics";
import { mensajeParaAxel } from "@/lib/sales/contacto-axel";

// La demo de cada odontólogo en una sola pantalla: la esfera de Sofi que late y le pide que le hable,
// el chat arriba a la derecha (para escribirle en lugar de hablarle) y la ficha de su consultorio abajo.
// La demo se arma al tocar la esfera, con los datos de su consultorio (tarda un segundo).

type Datos = { nombre: string; direccion: string | null; especialidad: string; profesional: string; servicios: string | null };
export type FichaPersonal = { consultorio: string; profesional: string; direccion: string | null; turnos: string[] };

const AGENTE = "Sofi";
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** El texto blanco adentro de la esfera se lee también sobre las nubes. */
const SOMBRA_TEXTO = "0 1px 10px rgba(14,50,160,.28)";
/** La demo armada en este navegador: si vuelve a la página, sigue con la misma. */
const guardada = (code: string) => `turnia-demo:${code}`;


export function DemoPersonal(props: {
  code: string;
  /** false cuando la mira Axel desde el panel: la demo no queda en su ficha. */
  contar: boolean;
  /** La demo está disponible (base y ElevenLabs configurados). */
  lista: boolean;
  datos: Datos;
  saludo: string;
  ficha: FichaPersonal;
  /** Lo que se le sugiere decir, empezando por su tratamiento principal. */
  ejemplos: string[];
}) {
  return (
    <ConversationProvider>
      <Pantalla {...props} />
    </ConversationProvider>
  );
}

function Pantalla({ code, contar, lista, datos, saludo, ficha, ejemplos }: Parameters<typeof DemoPersonal>[0]) {
  const sesion = useRef<string | null>(null);
  const fichaRef = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [pausada, setPausada] = useState(false);
  const codigo = contar ? code : null;

  useEffect(() => {
    try {
      sesion.current = sessionStorage.getItem(guardada(code));
    } catch {}
  }, [code]);

  /** Arma la demo (una vez por visita) y espera a que la ficha esté lista. Devuelve su token. */
  async function prepararDemo(): Promise<string> {
    if (sesion.current) return sesion.current;
    track("demo_started", { source: "personal", via: "navegador", with_web: false }, true);
    const res = await fetch("/api/demo/iniciar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...datos, via: "navegador", ...(contar ? { ref: code } : {}), ph: analyticsId() }),
    });
    const result = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!res.ok || !result.url) throw new Error(result.error || "No se pudo preparar la demo. Probá de nuevo.");
    const token = result.url.split("/").pop()!;
    for (let i = 0; ; i++) {
      const estado = await fetch(`/api/demo/web/${token}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (estado?.status === "lista") break;
      if (estado?.status === "error" || estado?.status === "terminada" || i >= 30) throw new Error("No se pudo preparar la demo. Probá de nuevo.");
      await espera(i < 6 ? 400 : 1000);
    }
    sesion.current = token;
    try {
      sessionStorage.setItem(guardada(code), token);
    } catch {}
    return token;
  }

  async function pedirCredencial(mode: DemoMode): Promise<DemoCredential> {
    const pedir = async () => {
      const token = await prepararDemo();
      return fetch(`/api/demo/web/${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode }) });
    };
    let res = await pedir();
    // Venció (24 horas) o usó sus conversaciones: se arma otra, sin que tenga que hacer nada.
    if (res.status === 404 || res.status === 429) {
      sesion.current = null;
      try {
        sessionStorage.removeItem(guardada(code));
      } catch {}
      res = await pedir();
    }
    const info = (await res.json()) as DemoCredential & { error?: string };
    if (!res.ok) throw new Error(info.error || "No se pudo iniciar la conversación.");
    return info;
  }

  const { mode, cambiarModo, lines, draft, setDraft, error, aviso, cerrada, connected, connecting, conversation, start, decir, send } = useCharlaDemo({
    agentName: AGENTE,
    pedirCredencial,
    modoInicial: "voz",
    conCierre: true,
  });
  const voz = mode === "voz";
  const enCharla = lines.length > 0;
  // Antes de hablar, la esfera ocupa la pantalla; en la llamada y después, deja lugar para lo de abajo.
  const compacta = enCharla || pausada || connected || cerrada;
  const estado = connecting ? "conectando" : connected ? (conversation.isSpeaking ? "habla" : "escucha") : "inactiva";
  const { getInputVolume, getOutputVolume } = conversation;
  const leerVolumen = connected ? (conversation.isSpeaking ? getOutputVolume : getInputVolume) : undefined;

  function hablar() {
    if (!lista) return setPausada(true);
    if (!connected && !connecting) void start();
  }

  useEffect(() => {
    const list = listRef.current;
    if (list && lines.length > 0) list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
  }, [lines, cerrada]);

  // Lo último que se dijo, como subtítulo debajo de la esfera.
  const ultima = [...lines].reverse().find((l) => l.role !== "system");
  const cierre = (
    <div className="animar-aparecer mx-auto max-w-sm text-center">
      <p className="text-[19px] font-medium leading-snug text-brand-950">
        {saludo}, ¿la dejamos atendiendo en {ficha.consultorio}?
      </p>
      <p className="mt-1.5 text-[15px] leading-relaxed text-tinta">Escribime y en 15 minutos te la muestro con tus horarios y tus tratamientos.</p>
      <BotonAxel texto={mensajeParaAxel({ saludo, consultorio: ficha.consultorio, probo: true })} donde="cierre" codigo={codigo} className="mt-4" />
    </div>
  );
  const enPausa = (
    <div className="animar-aparecer mx-auto max-w-sm text-center">
      <p className="text-[15px] leading-relaxed text-tinta">La demo está pausada por unos minutos. Escribime y te la muestro yo.</p>
      <BotonAxel texto={mensajeParaAxel({ saludo, consultorio: ficha.consultorio, probo: false })} donde="pagina" codigo={codigo} className="mt-4" />
    </div>
  );
  const avisos = (error || aviso) && (
    <p role={error ? "alert" : "status"} className={`mx-auto mt-3 max-w-sm rounded-xl px-3 py-2 text-center text-sm ${error ? "bg-red-50 text-red-700" : "bg-white/70 text-brand-900"}`}>
      {error || aviso}
    </p>
  );

  return (
    <div
      className="relative flex h-dvh min-h-[480px] flex-col overflow-hidden"
      style={{ background: "radial-gradient(120% 80% at 50% 42%, #ffffff 0%, #f7f9fd 60%, #eef2fa 100%)" }}
    >
      <header className="flex shrink-0 items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-8 sm:pt-6">
        <Logo />
        {/* Voz o chat: mientras hay una conversación abierta no se cambia. */}
        <div
          role="group"
          aria-label="Cómo querés probarla"
          title={connected ? "Terminá la conversación para cambiar" : undefined}
          className="grid grid-cols-2 gap-1 rounded-full bg-white/80 p-1 text-sm shadow-sm ring-1 ring-brand-950/10 backdrop-blur"
        >
          {(["voz", "chat"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              disabled={connected || connecting}
              onClick={() => cambiarModo(m)}
              className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-full px-3.5 font-medium transition-colors disabled:cursor-not-allowed ${
                mode === m ? "bg-brand-600 text-white shadow-sm" : "text-brand-900 hover:bg-white disabled:opacity-60"
              }`}
            >
              {m === "voz" ? <Microfono className="h-4 w-4" /> : <Icono nombre="chat" className="h-4 w-4" />}
              {m === "voz" ? "Voz" : "Chat"}
            </button>
          ))}
        </div>
      </header>

      {voz ? (
        <section aria-label={`Hablar con ${AGENTE}`} className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 [container-type:size]">
          <button
            type="button"
            onClick={hablar}
            disabled={connected || connecting}
            aria-label={`Hablar con ${AGENTE}`}
            className="relative shrink-0 rounded-full outline-none focus-visible:ring-4 focus-visible:ring-brand-500/40 disabled:cursor-default"
          >
            <EsferaCielo
              estado={estado}
              leerVolumen={leerVolumen}
              className={`transition-[width,height] duration-700 ${
                compacta ? "h-[min(56cqw,38cqh,330px)] w-[min(56cqw,38cqh,330px)]" : "h-[min(84cqw,62cqh,480px)] w-[min(84cqw,62cqh,480px)]"
              }`}
            >
              {/* Adentro de la esfera, lo que te pide: le habla al que llega. */}
              {pausada || connected ? null : connecting ? (
                <span className="text-[4.4cqw] font-medium tracking-[-0.01em] text-white/90" style={{ textShadow: SOMBRA_TEXTO }}>
                  Conectando…
                </span>
              ) : enCharla ? (
                <span className="text-[4.4cqw] font-medium tracking-[-0.01em] text-white/90" style={{ textShadow: SOMBRA_TEXTO }}>
                  Tocá para volver a hablar
                </span>
              ) : (
                <span className="flex max-w-[70%] flex-col items-center" style={{ textShadow: SOMBRA_TEXTO }}>
                  <span className="text-balance text-[6.4cqw] font-medium leading-[1.15] tracking-[-0.015em] text-white">Hablame como si fueras un paciente</span>
                  <span className="mt-[2.6cqw] text-[3.6cqw] font-normal tracking-[-0.005em] text-white/75">Tocá para hablar</span>
                </span>
              )}
            </EsferaCielo>
          </button>

          <div className={`w-full max-w-md text-center ${compacta || avisos ? "mt-[min(7cqh,3.5rem)]" : ""}`} aria-live="polite">
            {pausada ? (
              enPausa
            ) : connected ? (
              <>
                <p className="text-sm font-medium text-brand-800">
                  {conversation.isMuted ? "Micrófono silenciado" : conversation.isSpeaking ? `${AGENTE} está hablando…` : `${AGENTE} te escucha…`}
                </p>
                {ultima && (
                  <p key={ultima.id} className="animar-aparecer mt-2 line-clamp-3 text-[17px] leading-snug text-brand-950">
                    {ultima.text}
                  </p>
                )}
              </>
            ) : cerrada ? (
              cierre
            ) : null}
            {avisos}
          </div>

          {connected && (
            <div className="mt-5 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => conversation.setMuted(!conversation.isMuted)}
                aria-pressed={conversation.isMuted}
                aria-label={conversation.isMuted ? "Activar el micrófono" : "Silenciar el micrófono"}
                className={`grid h-11 w-11 place-items-center rounded-full ring-1 transition-colors ${
                  conversation.isMuted ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-brand-950 ring-brand-950/10 hover:bg-brand-50"
                }`}
              >
                <Microfono tachado={conversation.isMuted} className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => conversation.endSession()}
                className="inline-flex h-11 items-center gap-2 rounded-full bg-red-600 px-6 text-sm font-semibold text-white hover:bg-red-700"
              >
                <Icono nombre="telefono" className="h-4 w-4 rotate-[135deg]" /> Cortar
              </button>
            </div>
          )}
        </section>
      ) : (
        <section aria-label={`Chat con ${AGENTE}`} className="mx-auto flex min-h-0 w-full max-w-[620px] flex-1 flex-col px-4 pt-3">
          <div className="flex shrink-0 items-center gap-3">
            <EsferaCielo estado={estado} className="h-11 w-11" />
            <p className="min-w-0 text-sm leading-tight">
              <span className="block font-semibold text-brand-950">{AGENTE}</span>
              <span className="block truncate text-xs text-tinta">{connected ? "En línea" : `Recepción de ${ficha.consultorio}`}</span>
            </p>
          </div>
          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-4 text-[15px]" aria-live="polite">
            {!enCharla && (
              <div className="flex min-h-full flex-col items-center justify-center text-center">
                {pausada ? (
                  enPausa
                ) : (
                  <>
                    <p className="text-balance text-[22px] font-light leading-tight tracking-tight text-brand-950 sm:text-[26px]">Escribile como si fueras un paciente</p>
                    <ul className="mt-5 flex flex-wrap justify-center gap-2">
                      {ejemplos.map((idea, i) => (
                        <li key={idea}>
                          <button
                            type="button"
                            disabled={connecting}
                            onClick={() => (lista ? decir(idea, i) : setPausada(true))}
                            className="rounded-full bg-white px-3.5 py-2 text-left text-sm text-brand-800 shadow-sm ring-1 ring-brand-950/10 hover:bg-brand-50 disabled:opacity-60"
                          >
                            {idea}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
            <div className="space-y-2">
              {lines.map((line) =>
                line.role === "system" ? (
                  <p key={line.id} className="text-center text-xs text-tinta">
                    {line.text}
                  </p>
                ) : (
                  <p
                    key={line.id}
                    className={`w-fit max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 ${
                      line.role === "user" ? "ml-auto rounded-br-md bg-brand-600 text-white" : "rounded-bl-md bg-white text-brand-950 ring-1 ring-brand-950/5"
                    }`}
                  >
                    {line.text}
                  </p>
                ),
              )}
            </div>
            {cerrada && <div className="mt-6">{cierre}</div>}
          </div>
          {avisos}
          <form
            onSubmit={(e) => {
              if (!lista) {
                e.preventDefault();
                return setPausada(true);
              }
              send(e);
            }}
            className="flex shrink-0 gap-2 py-3"
          >
            <label htmlFor="mensaje" className="sr-only">
              Mensaje para {AGENTE}
            </label>
            <input
              id="mensaje"
              value={draft}
              autoComplete="off"
              enterKeyHint="send"
              onChange={(e) => {
                setDraft(e.target.value);
                if (connected) conversation.sendUserActivity();
              }}
              disabled={connecting}
              placeholder={`Escribile a ${AGENTE}…`}
              className="min-w-0 flex-1 rounded-full bg-white px-4 py-3 text-[16px] text-brand-950 shadow-sm outline-none ring-1 ring-brand-950/10 placeholder:text-tinta/85 focus:ring-2 focus:ring-brand-600"
            />
            <button type="submit" disabled={connecting || !draft.trim()} className="rounded-full bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40">
              {connecting ? "Conectando…" : "Enviar"}
            </button>
          </form>
          {connected && (
            <button type="button" onClick={() => conversation.endSession()} className="-mt-1 mb-1 self-center text-xs font-medium text-brand-700 hover:underline">
              Terminar la conversación
            </button>
          )}
        </section>
      )}

      {/* Abajo, solo la ficha de su consultorio. En el chat con el teclado abierto se esconde. */}
      <div className={`shrink-0 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 sm:pb-6 ${voz ? "" : "[@media(max-height:560px)]:hidden"}`}>
        <button
          type="button"
          onClick={() => fichaRef.current?.showModal()}
          aria-haspopup="dialog"
          className="mx-auto flex w-full max-w-[420px] items-center gap-3 rounded-2xl bg-white/80 px-4 py-3 text-left shadow-[0_8px_30px_rgb(8_24_63/0.08)] ring-1 ring-brand-950/10 backdrop-blur transition-colors hover:bg-white"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">
            <Icono nombre="diente" className="h-[18px] w-[18px]" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs text-tinta">La ficha de tu consultorio</span>
            <span className="block truncate text-[15px] font-semibold text-brand-950">{ficha.consultorio}</span>
          </span>
          <Chevron className="h-4 w-4 shrink-0 rotate-180 text-brand-900/60" />
        </button>
      </div>

      <dialog
        ref={fichaRef}
        aria-labelledby="ficha-titulo"
        onClick={(e) => e.target === e.currentTarget && e.currentTarget.close()}
        className="mx-auto mb-0 mt-auto max-h-[85dvh] w-full max-w-[480px] overflow-y-auto rounded-t-3xl bg-white shadow-2xl backdrop:bg-brand-950/40 sm:mb-6 sm:rounded-3xl"
      >
        <div className="animar-aparecer px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:pb-6" style={{ animationDuration: "0.25s" }}>
          <span aria-hidden="true" className="mx-auto block h-1 w-10 rounded-full bg-brand-950/15 sm:hidden" />
          <div className="mt-2 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id="ficha-titulo" className="text-xs font-medium text-tinta">
                La ficha de tu consultorio
              </h2>
              <p className="mt-0.5 text-lg font-semibold leading-snug text-brand-950">{ficha.consultorio}</p>
            </div>
            <button
              type="button"
              onClick={() => fichaRef.current?.close()}
              aria-label="Cerrar"
              className="-mr-2 grid h-10 w-10 shrink-0 place-items-center rounded-full text-brand-950 hover:bg-brand-50"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <dl className="mt-4 space-y-3 text-sm">
            <Dato titulo="Profesional">{ficha.profesional}</Dato>
            {ficha.direccion && <Dato titulo="Dirección">{ficha.direccion}</Dato>}
            <Dato titulo="Especialidad">Odontología</Dato>
            <div>
              <dt className="text-xs text-brand-900/65">Turnos que puede dar</dt>
              <dd className="mt-1.5 flex flex-wrap gap-1.5">
                {ficha.turnos.map((t) => (
                  <span key={t} className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-800">
                    {t}
                  </span>
                ))}
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-xs leading-relaxed text-tinta">
            Con esto se preparó {AGENTE}. Los horarios y las coberturas son de prueba: en tu cuenta los cargás vos. Los turnos que reserves no llegan a ningún
            paciente ni a tu agenda.
          </p>
          <div className="mt-5 border-t border-brand-950/5 pt-4">
            <p className="text-sm text-tinta">¿Preferís que te la muestre yo? Son 15 minutos.</p>
            <BotonAxel
              variante="secundario"
              className="mt-3 w-full"
              texto={mensajeParaAxel({ saludo, consultorio: ficha.consultorio, probo: enCharla })}
              donde={enCharla ? "demo" : "pagina"}
              codigo={codigo}
            />
          </div>
        </div>
      </dialog>
    </div>
  );
}

function Dato({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-brand-900/65">{titulo}</dt>
      <dd className="mt-0.5 font-medium text-brand-950">{children}</dd>
    </div>
  );
}

function Microfono({ className = "h-5 w-5", tachado = false }: { className?: string; tachado?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
      <path d="M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
      {tachado && <path d="M4 4l16 16" />}
    </svg>
  );
}
